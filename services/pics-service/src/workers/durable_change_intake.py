"""Restart-safe Steam PICS change intake backed by Tiger."""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Optional

import gevent

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


class IncompletePICSChangeResponseError(RuntimeError):
    """Raised when Steam cannot provide a complete incremental change response."""


class DurableChangeIntakeWorker:
    """Poll PICS and commit each upstream response before moving its cursor."""

    MAX_CONSECUTIVE_POLL_FAILURES = 3
    MIN_SAFE_PRODUCT_INFO_INTERVAL_SECONDS = 212

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
        self._consecutive_processing_failures = 0
        self._last_processing_error: Optional[str] = None
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
        if (
            self._processor is not None
            and int(settings.pics_product_info_min_interval_seconds)
            < self.MIN_SAFE_PRODUCT_INFO_INTERVAL_SECONDS
        ):
            raise ValueError(
                "PICS_PRODUCT_INFO_MIN_INTERVAL_SECONDS cannot be below "
                f"{self.MIN_SAFE_PRODUCT_INFO_INTERVAL_SECONDS} during the "
                "bounded product-info canary"
            )
        self._last_processing_stats: Optional[PICSProcessingStats] = None
        self._last_processing_started_at: Optional[str] = None
        self._next_processing_at_monotonic = 0.0
        self._last_intake_phase_seconds: dict[str, float | int] = {}

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
                sleep_seconds = float(settings.poll_interval)
                try:
                    last_change = self.poll_once(last_change)
                    self._consecutive_poll_failures = 0
                    self._last_poll_error = None
                    self._last_successful_change_poll_at = datetime.now(timezone.utc).isoformat()
                except IncompletePICSChangeResponseError as error:
                    self._consecutive_poll_failures += 1
                    self._last_poll_error = str(error)
                    sleep_seconds = self._failure_backoff_seconds(self._consecutive_poll_failures)
                    logger.error(
                        "Durable PICS intake is source-blocked (failure #%s, "
                        "retrying in at most %ss while durable processing continues): %s",
                        self._consecutive_poll_failures,
                        sleep_seconds,
                        error,
                    )
                except Exception as error:
                    self._consecutive_poll_failures += 1
                    self._last_poll_error = str(error)
                    sleep_seconds = self._failure_backoff_seconds(self._consecutive_poll_failures)
                    logger.error(
                        "Error in durable PICS poll (failure #%s, backing off %ss): %s",
                        self._consecutive_poll_failures,
                        sleep_seconds,
                        error,
                    )
                    if self._consecutive_poll_failures >= self.MAX_CONSECUTIVE_POLL_FAILURES:
                        self._update_health_status(last_change, forced_state="unhealthy")
                        raise RuntimeError(
                            "Exceeded consecutive durable PICS poll failures; exiting"
                        ) from error

                try:
                    self._process_once_if_due()
                except Exception as error:
                    self._consecutive_processing_failures += 1
                    self._last_processing_error = str(error)
                    processing_backoff_seconds = self._failure_backoff_seconds(
                        self._consecutive_processing_failures
                    )
                    logger.error(
                        "Error in durable PICS processing (failure #%s, backing off %ss): %s",
                        self._consecutive_processing_failures,
                        processing_backoff_seconds,
                        error,
                    )
                    if self._consecutive_processing_failures >= self.MAX_CONSECUTIVE_POLL_FAILURES:
                        self._update_health_status(last_change, forced_state="unhealthy")
                        raise RuntimeError(
                            "Exceeded consecutive durable PICS processing failures; exiting"
                        ) from error
                    sleep_seconds = min(sleep_seconds, processing_backoff_seconds)

                if self._processor is not None:
                    seconds_until_processing = max(
                        0.0,
                        self._next_processing_at_monotonic - time.monotonic(),
                    )
                    if seconds_until_processing > 0:
                        sleep_seconds = min(sleep_seconds, seconds_until_processing)

                self._update_health_status(last_change)
                gevent.sleep(sleep_seconds)
        finally:
            self._steam.disconnect()

    def poll_once(self, last_change: int) -> int:
        """Poll once, returning a later cursor only after the batch commits."""

        total_started = time.perf_counter()
        phase_seconds: dict[str, float | int] = {}
        try:
            return self._poll_once(last_change, phase_seconds)
        finally:
            phase_seconds["total"] = time.perf_counter() - total_started
            self._last_intake_phase_seconds = {
                key: round(value, 3) if isinstance(value, float) else value
                for key, value in sorted(phase_seconds.items())
            }
            logger.info(
                "Durable PICS intake metrics %s",
                json.dumps(
                    self._last_intake_phase_seconds,
                    sort_keys=True,
                    separators=(",", ":"),
                ),
            )

    def _poll_once(
        self,
        last_change: int,
        phase_seconds: dict[str, float | int],
    ) -> int:
        if self._fetcher is None:
            raise RuntimeError("PICS fetcher is not initialized")

        phase_started = time.perf_counter()
        try:
            changes = self._fetcher.get_changes_since(last_change)
        finally:
            phase_seconds["steam_change_poll"] = time.perf_counter() - phase_started
            phase_seconds["steam_change_poll_requests"] = int(
                getattr(self._fetcher, "last_change_poll_attempts", 1)
            )
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
        phase_started = time.perf_counter()
        try:
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
        finally:
            phase_seconds["r2_change_archive"] = time.perf_counter() - phase_started
        phase_started = time.perf_counter()
        try:
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
        finally:
            phase_seconds["tiger_batch_persist"] = time.perf_counter() - phase_started
        if committed.to_change_number != changes.change_number:
            raise RuntimeError("Committed PICS batch cursor does not match the source response")

        self._last_committed_batch = committed
        if not committed.source_complete:
            raise IncompletePICSChangeResponseError(
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

    def _processing_due(self, now_monotonic: Optional[float] = None) -> bool:
        now = time.monotonic() if now_monotonic is None else now_monotonic
        return now >= self._next_processing_at_monotonic

    def _process_once_if_due(self) -> None:
        if self._processor is None or not self._processing_due():
            return
        if self._fetcher is None:
            raise RuntimeError("PICS fetcher is not initialized")

        processing_started = time.monotonic()
        self._next_processing_at_monotonic = processing_started + int(
            settings.pics_product_info_min_interval_seconds
        )
        self._last_processing_started_at = datetime.now(timezone.utc).isoformat()
        self._last_processing_stats = self._processor.process_once(self._fetcher)
        self._consecutive_processing_failures = 0
        self._last_processing_error = None

    @staticmethod
    def _failure_backoff_seconds(consecutive_failures: int) -> float:
        return float(
            min(
                max(settings.poll_interval, 10) * (2 ** min(max(consecutive_failures, 1) - 1, 4)),
                300,
            )
        )

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
            self._consecutive_poll_failures > 0
            or self._consecutive_processing_failures > 0
            or not self._steam.is_connected
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
                "processing_concurrency": (
                    int(settings.pics_consumer_concurrency) if self._processor is not None else None
                ),
                "product_info_min_interval_seconds": (
                    int(settings.pics_product_info_min_interval_seconds)
                    if self._processor is not None
                    else None
                ),
                "processing_seconds_until_eligible": (
                    round(
                        max(
                            0.0,
                            self._next_processing_at_monotonic - time.monotonic(),
                        ),
                        1,
                    )
                    if self._processor is not None
                    else None
                ),
                "last_processing_started_at": self._last_processing_started_at,
                "last_processing_claimed": processing.claimed if processing else None,
                "last_processing_live_claimed": (processing.live_claimed if processing else None),
                "last_processing_catchup_claimed": (
                    processing.catchup_claimed if processing else None
                ),
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
                "last_processing_duration_seconds": (
                    processing.duration_seconds if processing else None
                ),
                "last_processing_product_info_requests": (
                    processing.product_info_requests if processing else None
                ),
                "last_processing_heartbeat_transactions": (
                    processing.heartbeat_transactions if processing else None
                ),
                "last_processing_tiger_transactions": (
                    processing.tiger_transactions if processing else None
                ),
                "last_processing_tiger_transactions_per_settlement": (
                    processing.tiger_transactions_per_settlement if processing else None
                ),
                "last_processing_r2_reads": processing.r2_reads if processing else None,
                "last_processing_r2_writes": processing.r2_writes if processing else None,
                "last_processing_phase_seconds": (processing.phase_seconds if processing else None),
                "last_processing_phase_latency_seconds": (
                    processing.phase_latency_seconds if processing else None
                ),
                "processing_queue_metrics": (processing.queue_metrics if processing else None),
                "last_intake_phase_seconds": self._last_intake_phase_seconds,
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
                "consecutive_processing_failures": self._consecutive_processing_failures,
                "last_processing_error": self._last_processing_error,
            }
        )
