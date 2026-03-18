"""Worker for real-time PICS change monitoring."""

import logging
import time
from collections import deque
from datetime import datetime
from typing import Any, Dict, Optional, Set

from ..steam.client import PICSSteamClient
from ..steam.pics import PICSFetcher
from ..extractors.common import PICSExtractor
from ..database.operations import PICSDatabase
from ..health.server import HealthServer
from ..config.settings import settings

logger = logging.getLogger(__name__)


class ChangeMonitorWorker:
    """
    Worker for real-time PICS change monitoring.

    Polls for changes and queues affected apps for re-fetch.
    Designed to run continuously on Railway.
    """

    def __init__(self, health_server: Optional[HealthServer] = None):
        self._steam = PICSSteamClient()
        self._fetcher: Optional[PICSFetcher] = None
        self._extractor = PICSExtractor()
        self._db = PICSDatabase()
        self._health = health_server

        self._change_queue: deque = deque(maxlen=settings.max_queue_size)
        self._processing_set: Set[int] = set()
        self._running = False
        self._consecutive_poll_failures = 0
        self._last_poll_error: Optional[str] = None
        self._last_successful_change_poll_at: Optional[str] = None

    def run(self):
        """
        Run the change monitor continuously.

        This is the main entry point for Railway deployment.
        """
        logger.info("Starting PICS change monitor")
        self._running = True

        # Configure client for long-running operation
        self._steam.set_heartbeat_interval(settings.steam_heartbeat_interval)
        self._steam.set_auto_reconnect(settings.steam_auto_reconnect)

        # Connect to Steam
        if not self._steam.connect():
            raise RuntimeError("Failed to connect to Steam")

        self._fetcher = PICSFetcher(
            self._steam,
            timeout=settings.bulk_timeout,
            max_retries=settings.bulk_max_retries,
        )

        # Get last known change number
        last_change = self._db.get_last_change_number()
        logger.info(f"Starting from change number {last_change}")

        # Main loop
        while self._running:
            try:
                # Check for new changes
                changes = self._fetcher.get_changes_since(last_change)
                self._consecutive_poll_failures = 0
                self._last_poll_error = None
                self._last_successful_change_poll_at = datetime.utcnow().isoformat()

                if changes and changes.change_number > last_change:
                    # Queue changed apps
                    new_apps = [
                        appid
                        for appid in changes.app_changes
                        if appid not in self._processing_set
                    ]

                    for appid in new_apps:
                        if len(self._change_queue) < settings.max_queue_size:
                            self._change_queue.append(appid)

                    logger.info(
                        f"Change {changes.change_number}: "
                        f"{len(changes.app_changes)} apps changed, "
                        f"{len(new_apps)} queued (queue size: {len(self._change_queue)})"
                    )

                    last_change = changes.change_number
                    self._db.set_last_change_number(last_change)

                # Process queued apps
                self._process_queue(last_change)

                # Update health status
                self._update_health_status(last_change)

                # Wait before next poll
                time.sleep(settings.poll_interval)

            except Exception as e:
                self._consecutive_poll_failures += 1
                self._last_poll_error = str(e)
                backoff_seconds = min(
                    max(settings.poll_interval, 10) * (2 ** min(self._consecutive_poll_failures - 1, 4)),
                    300,
                )
                logger.error(
                    "Error in change monitor loop (failure #%s, backing off %ss): %s",
                    self._consecutive_poll_failures,
                    backoff_seconds,
                    e,
                )
                self._update_health_status(last_change)
                time.sleep(backoff_seconds)

        # Cleanup
        self._steam.disconnect()

    def _process_queue(self, trigger_cursor: Optional[int] = None):
        """Process a batch of queued apps."""
        if not self._change_queue:
            return

        # Get batch from queue
        batch = []
        while self._change_queue and len(batch) < settings.process_batch_size:
            appid = self._change_queue.popleft()
            batch.append(appid)
            self._processing_set.add(appid)

        if not batch:
            return

        try:
            # Fetch PICS data
            raw_data = self._fetcher.fetch_apps_batch(batch)

            # Extract and persist
            extracted = []
            for appid_str, data in raw_data.items():
                try:
                    appid = int(appid_str)
                    extracted.append(self._extractor.extract(appid, data))
                except Exception as e:
                    logger.error(f"Failed to extract app {appid_str}: {e}")

            if extracted:
                self._db.upsert_apps_batch(
                    extracted,
                    trigger_reason="change_monitor",
                    trigger_cursor=str(trigger_cursor) if trigger_cursor is not None else None,
                )

            logger.debug(f"Processed {len(extracted)} apps from queue")

        except Exception as e:
            logger.error(f"Failed to process queue batch: {e}")
            # Re-queue failed apps
            for appid in batch:
                if len(self._change_queue) < settings.max_queue_size:
                    self._change_queue.append(appid)
        finally:
            # Remove from processing set
            for appid in batch:
                self._processing_set.discard(appid)

    def stop(self):
        """Signal the monitor to stop."""
        logger.info("Stopping change monitor")
        self._running = False

    def _update_health_status(self, last_change: int):
        """Publish worker health and Steam reconnect state."""
        if not self._health:
            return

        health_state = "ok"
        if self._consecutive_poll_failures > 0 or not self._steam.is_connected:
            health_state = "degraded"

        self._health.update_status(
            {
                "mode": "change_monitor",
                "health_state": health_state,
                "last_change": last_change,
                "queue_size": len(self._change_queue),
                "processing": len(self._processing_set),
                "connected": self._steam.is_connected,
                "steam_connected": self._steam.is_connected,
                "connection_age_seconds": round(self._steam.connection_age_seconds or 0, 1),
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
