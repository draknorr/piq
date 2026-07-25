"""Restart-safe Steam PICS change intake backed by Tiger."""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Optional

from ..config.settings import settings
from ..database.durable_intake import (
    PersistedPICSBatch,
    PICSArchiveReference,
    PICSSourceAppChange,
    TigerPICSDurableIntakeStore,
    hash_pics_app_changes,
)
from ..database.tiger_change_history import S3ArchiveStore
from ..health.server import HealthServer
from ..steam.client import PICSSteamClient
from ..steam.pics import PICSFetcher
from .durable_processor import DurablePICSProcessor, PICSProcessingStats

logger = logging.getLogger(__name__)


class DurableChangeIntakeWorker:
    """Poll PICS and commit each upstream response before moving its cursor."""

    MAX_CONSECUTIVE_POLL_FAILURES = 3

    def __init__(
        self,
        *,
        work_mode: str,
        health_server: Optional[HealthServer] = None,
    ):
        if work_mode not in {"shadow", "durable"}:
            raise ValueError("DurableChangeIntakeWorker requires shadow or durable mode")

        self._work_mode = work_mode
        self._stream_key = (
            "primary" if work_mode == "durable" else settings.pics_intake_stream_key.strip()
        )
        if not self._stream_key:
            raise ValueError("PICS_INTAKE_STREAM_KEY is required in shadow mode")
        self._lane = settings.pics_intake_lane.strip().lower()
        if self._lane not in {"live", "catchup"}:
            raise ValueError("PICS_INTAKE_LANE must be live or catchup")

        self._steam = PICSSteamClient()
        self._fetcher: Optional[PICSFetcher] = None
        self._store = TigerPICSDurableIntakeStore.from_settings(settings)
        self._archive_store = S3ArchiveStore.from_env()
        self._health = health_server
        self._running = False
        self._consecutive_poll_failures = 0
        self._last_poll_error: Optional[str] = None
        self._last_successful_change_poll_at: Optional[str] = None
        self._last_committed_batch: Optional[PersistedPICSBatch] = None
        self._processor = (
            DurablePICSProcessor(
                work_mode=self._work_mode,
                stream_key=self._stream_key,
                archive_store=self._archive_store,
            )
            if settings.pics_processing_enabled
            else None
        )
        self._last_processing_stats: Optional[PICSProcessingStats] = None

    def run(self) -> None:
        """Run the durable intake leader continuously."""

        logger.info(
            "Starting durable PICS intake (work_mode=%s, stream=%s)",
            self._work_mode,
            self._stream_key,
        )
        self._running = True
        self._steam.set_heartbeat_interval(settings.steam_heartbeat_interval)
        self._steam.set_auto_reconnect(settings.steam_auto_reconnect)

        last_change = self._store.get_start_change_number(
            work_mode=self._work_mode,
            stream_key=self._stream_key,
            shadow_start_change_number=settings.pics_shadow_start_change_number,
        )
        logger.info("Starting durable PICS intake from change number %s", last_change)

        if not self._steam.connect():
            raise RuntimeError("Failed to connect to Steam")

        self._fetcher = PICSFetcher(
            self._steam,
            timeout=settings.bulk_timeout,
            max_retries=settings.bulk_max_retries,
        )
        self._update_health_status(last_change)

        try:
            while self._running:
                try:
                    last_change = self.poll_once(last_change)
                    if self._processor is not None:
                        if self._fetcher is None:
                            raise RuntimeError("PICS fetcher is not initialized")
                        self._last_processing_stats = self._processor.process_once(self._fetcher)
                    self._consecutive_poll_failures = 0
                    self._last_poll_error = None
                    self._last_successful_change_poll_at = datetime.now(timezone.utc).isoformat()
                    self._update_health_status(last_change)
                    time.sleep(settings.poll_interval)
                except Exception as error:
                    self._consecutive_poll_failures += 1
                    self._last_poll_error = str(error)
                    backoff_seconds = min(
                        max(settings.poll_interval, 10)
                        * (2 ** min(self._consecutive_poll_failures - 1, 4)),
                        300,
                    )
                    logger.error(
                        "Error in durable PICS intake (failure #%s, backing off %ss): %s",
                        self._consecutive_poll_failures,
                        backoff_seconds,
                        error,
                    )
                    if self._consecutive_poll_failures >= self.MAX_CONSECUTIVE_POLL_FAILURES:
                        self._update_health_status(last_change, forced_state="unhealthy")
                        raise RuntimeError(
                            "Exceeded consecutive durable PICS intake failures; exiting"
                        ) from error
                    self._update_health_status(last_change)
                    time.sleep(backoff_seconds)
        finally:
            self._steam.disconnect()

    def poll_once(self, last_change: int) -> int:
        """Poll once, returning a later cursor only after the batch commits."""

        if self._fetcher is None:
            raise RuntimeError("PICS fetcher is not initialized")

        changes = self._fetcher.get_changes_since(last_change)
        if changes is None or changes.change_number <= last_change:
            return last_change

        if changes.app_change_details is None:
            raise RuntimeError("PICS durable intake requires item-level change metadata")
        source_app_changes = [
            PICSSourceAppChange(
                appid=change.appid,
                change_number=change.change_number,
                needs_token=change.needs_token,
            )
            for change in changes.app_change_details
        ]
        archive = self._archive_change_response(
            from_change_number=last_change,
            to_change_number=changes.change_number,
            response_since_change_number=changes.since_change_number,
            app_changes=source_app_changes,
            package_changes=changes.package_changes,
            force_full_update=changes.force_full_update,
            force_full_app_update=changes.force_full_app_update,
            force_full_package_update=changes.force_full_package_update,
        )
        committed = self._store.persist_batch(
            archive=archive,
            from_change_number=last_change,
            to_change_number=changes.change_number,
            response_since_change_number=changes.since_change_number,
            app_changes=source_app_changes,
            force_full_update=changes.force_full_update,
            force_full_app_update=changes.force_full_app_update,
            force_full_package_update=changes.force_full_package_update,
            work_mode=self._work_mode,
            stream_key=self._stream_key,
            lane=self._lane,
        )
        if committed.to_change_number != changes.change_number:
            raise RuntimeError("Committed PICS batch cursor does not match the source response")

        self._last_committed_batch = committed
        if not committed.source_complete:
            raise RuntimeError(
                "PICS returned an incomplete app-change response; "
                f"batch {committed.batch_id} was retained as source_blocked and "
                "the intake cursor was not advanced "
                f"(requested_since={last_change}, "
                f"response_since={committed.response_since_change_number}, "
                f"force_full_update={committed.force_full_update}, "
                f"force_full_app_update={committed.force_full_app_update})"
            )
        logger.info(
            "Committed PICS batch %s (%s -> %s, source=%s, distinct=%s, replay=%s)",
            committed.batch_id,
            committed.from_change_number,
            committed.to_change_number,
            committed.source_app_count,
            committed.distinct_app_count,
            committed.idempotent_replay,
        )
        return committed.to_change_number

    def _archive_change_response(
        self,
        *,
        from_change_number: int,
        to_change_number: int,
        response_since_change_number: int,
        app_changes: list[PICSSourceAppChange],
        package_changes: list[int],
        force_full_update: bool,
        force_full_app_update: bool,
        force_full_package_update: bool,
    ) -> PICSArchiveReference:
        """Archive an exact response before its Tiger transaction can advance."""

        app_changes_sha256 = hash_pics_app_changes(app_changes)
        document = {
            "_archive_schema_version": "pics-change-response/v2",
            "stream_key": self._stream_key,
            "work_mode": self._work_mode,
            "lane": self._lane,
            "from_change_number": from_change_number,
            "to_change_number": to_change_number,
            "response_since_change_number": response_since_change_number,
            "source_app_count": len(app_changes),
            "distinct_app_count": len({change.appid for change in app_changes}),
            "app_changes_sha256": app_changes_sha256,
            "force_full_update": force_full_update,
            "force_full_app_update": force_full_app_update,
            "force_full_package_update": force_full_package_update,
            "app_changes": [
                {
                    "source_index": source_index,
                    "appid": change.appid,
                    "change_number": change.change_number,
                    "needs_token": change.needs_token,
                }
                for source_index, change in enumerate(app_changes)
            ],
            "package_changes": [int(package_id) for package_id in package_changes],
        }
        pointer = self._archive_store.write_json(
            content_hash=None,
            key_parts=[
                self._stream_key,
                str(from_change_number),
                str(to_change_number),
                app_changes_sha256,
            ],
            kind="pics-change-response",
            payload=document,
        )
        return PICSArchiveReference(
            bucket=pointer.bucket,
            key=pointer.key,
            content_hash=pointer.content_hash,
            byte_size=pointer.byte_size,
            content_type=pointer.content_type,
        )

    def stop(self) -> None:
        """Signal the intake leader to stop after its current operation."""

        logger.info("Stopping durable PICS intake")
        self._running = False

    def _update_health_status(
        self,
        last_change: int,
        forced_state: Optional[str] = None,
    ) -> None:
        if not self._health:
            return

        health_state = forced_state or "ok"
        if forced_state is None and (
            self._consecutive_poll_failures > 0 or not self._steam.is_connected
        ):
            health_state = "degraded"

        batch = self._last_committed_batch
        processing = self._last_processing_stats
        self._health.update_status(
            {
                "mode": "change_monitor",
                "pics_work_mode": self._work_mode,
                "intake_stream": self._stream_key,
                "intake_lane": self._lane,
                "intake_only": self._processor is None,
                "processing_enabled": self._processor is not None,
                "processing_worker_id": (
                    self._processor.worker_id if self._processor is not None else None
                ),
                "last_processing_claimed": processing.claimed if processing else None,
                "last_processing_completed": processing.completed if processing else None,
                "last_processing_retried": processing.retried if processing else None,
                "last_processing_dead_lettered": (processing.dead_lettered if processing else None),
                "last_processing_source_blocked": (
                    processing.source_blocked if processing else None
                ),
                "last_processing_snapshots_changed": (
                    processing.snapshots_changed if processing else None
                ),
                "last_processing_events_created": (
                    processing.events_created if processing else None
                ),
                "health_state": health_state,
                "last_change": last_change,
                "last_committed_batch_id": str(batch.batch_id) if batch else None,
                "last_committed_batch_to_change_number": (
                    batch.to_change_number if batch else None
                ),
                "last_committed_source_app_count": (batch.source_app_count if batch else None),
                "connected": self._steam.is_connected,
                "steam_connected": self._steam.is_connected,
                "connection_age_seconds": round(
                    self._steam.connection_age_seconds or 0,
                    1,
                ),
                "reconnect_in_progress": self._steam.is_reconnecting,
                "reconnect_attempts": self._steam.reconnect_attempts,
                "last_reconnect_error": self._steam.last_reconnect_error,
                "last_disconnect_at": self._steam.last_disconnect_at,
                "last_successful_connection_at": self._steam.last_successful_connection_at,
                "last_successful_change_poll_at": self._last_successful_change_poll_at,
                "consecutive_poll_failures": self._consecutive_poll_failures,
                "last_poll_error": self._last_poll_error,
            }
        )
