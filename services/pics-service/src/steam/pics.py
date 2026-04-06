"""PICS-specific operations for fetching Steam app data."""

import logging
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, Generator, List, Optional

import gevent

from .client import PICSSteamClient

logger = logging.getLogger(__name__)


@dataclass
class PICSChange:
    """Represents a PICS change notification."""

    change_number: int
    app_changes: List[int]
    package_changes: List[int]


class PICSFetcher:
    """Handles PICS data fetching operations."""

    BATCH_SIZE = 200  # Apps per request (PICS supports up to ~300)
    REQUEST_DELAY = 0.5  # Seconds between batches (conservative)
    DEFAULT_TIMEOUT = 60  # Seconds per batch fetch
    DEFAULT_MAX_RETRIES = 5  # Retry attempts per batch
    AUTO_RECONNECT_WAIT_TIMEOUT = 30  # Seconds to wait before forcing reconnect
    MANUAL_RECONNECT_ATTEMPTS = 3  # Manual reconnect attempts when polling changes

    def __init__(
        self,
        client: PICSSteamClient,
        batch_size: int = None,
        request_delay: float = None,
        timeout: int = None,
        max_retries: int = None,
        change_poll_timeout: float | None = None,
    ):
        self._client = client
        self.batch_size = batch_size or self.BATCH_SIZE
        self.request_delay = request_delay or self.REQUEST_DELAY
        self.timeout = timeout or self.DEFAULT_TIMEOUT
        self.max_retries = max_retries or self.DEFAULT_MAX_RETRIES
        self.change_poll_timeout = change_poll_timeout or self.timeout

    def _ensure_connection(self, wait_timeout: float = AUTO_RECONNECT_WAIT_TIMEOUT) -> None:
        """Recover a disconnected Steam client before issuing a request."""
        if self._client.ensure_connected(
            wait_timeout=wait_timeout,
            reconnect_attempts=self.MANUAL_RECONNECT_ATTEMPTS,
        ):
            return

        raise RuntimeError("Failed to reconnect to Steam")

    def fetch_apps_batch(self, appids: List[int]) -> Dict[int, Dict[str, Any]]:
        """
        Fetch PICS data for a batch of apps with retry logic.

        Args:
            appids: List of app IDs to fetch (max ~200 recommended)

        Returns:
            Dict mapping appid to PICS data
        """
        for attempt in range(self.max_retries):
            self._ensure_connection(wait_timeout=120)

            try:
                response = self._client.client.get_product_info(apps=appids, timeout=self.timeout)

                if response is None:
                    logger.warning(f"No response for batch starting at {appids[0] if appids else 'empty'}")
                    return {}

                return response.get("apps", {})
            except BaseException as e:
                # Catch BaseException to handle gevent.timeout.Timeout which doesn't extend Exception
                age = self._client.connection_age_seconds
                age_str = f"{age:.1f}s" if age is not None else "N/A"

                if attempt < self.max_retries - 1:
                    delay = 2 ** (attempt + 1)  # 2, 4, 8 seconds
                    logger.warning(
                        f"Batch attempt {attempt + 1}/{self.max_retries} failed "
                        f"(connection age: {age_str}), retrying in {delay}s: {e}"
                    )
                    time.sleep(delay)
                else:
                    logger.error(
                        f"Error fetching PICS data after {self.max_retries} attempts "
                        f"(connection age: {age_str}): {e}"
                    )
                    raise

    def fetch_all_apps(
        self,
        appids: List[int],
        batch_callback: Optional[Callable[[Dict, int, int], None]] = None,
    ) -> Generator[Dict[int, Dict], None, None]:
        """
        Fetch PICS data for all apps in batches.

        Yields batches of app data as they're fetched.
        At ~200 apps/request and 2 req/sec, 70k apps takes ~3 minutes.

        Args:
            appids: List of all app IDs to fetch
            batch_callback: Optional callback(result, processed, total) after each batch

        Yields:
            Dict mapping appid to PICS data for each batch
        """
        total_apps = len(appids)
        processed = 0
        failed_batches: List[List[int]] = []

        for i in range(0, total_apps, self.batch_size):
            batch = appids[i : i + self.batch_size]

            try:
                result = self.fetch_apps_batch(batch)
                processed += len(batch)

                logger.info(
                    f"Fetched {processed}/{total_apps} apps ({processed / total_apps * 100:.1f}%)"
                )

                if batch_callback:
                    batch_callback(result, processed, total_apps)

                yield result

                # Rate limiting
                time.sleep(self.request_delay)

            except Exception as e:
                logger.error(f"Batch failed at offset {i} ({len(batch)} apps): {e}")
                failed_batches.append(batch)
                # Continue with next batch after delay
                time.sleep(2)

        # Log summary of failed batches
        if failed_batches:
            total_failed = sum(len(b) for b in failed_batches)
            failed_ids = [appid for batch in failed_batches for appid in batch[:5]]  # First 5 from each
            logger.error(
                f"Sync completed with {len(failed_batches)} failed batches ({total_failed} apps). "
                f"Sample failed IDs: {failed_ids}"
            )

    def get_changes_since(self, change_number: int) -> Optional[PICSChange]:
        """
        Get changes since the specified change number.

        Args:
            change_number: Last known change number (0 for initial)

        Returns:
            PICSChange with new change_number and list of changed app IDs
        """
        for attempt in range(self.max_retries):
            try:
                self._ensure_connection(wait_timeout=self.AUTO_RECONNECT_WAIT_TIMEOUT)
                timeout_error = TimeoutError(
                    f"PICS change poll timed out after {self.change_poll_timeout}s"
                )
                with gevent.Timeout(self.change_poll_timeout, timeout_error):
                    response = self._client.client.get_changes_since(
                        change_number,
                        app_changes=True,
                        package_changes=False,  # We only care about apps
                    )

                if response is None:
                    raise TimeoutError(
                        "PICS change poll returned no response before the client timeout"
                    )

                return PICSChange(
                    change_number=response.current_change_number,
                    app_changes=[c.appid for c in (response.app_changes or [])],
                    package_changes=[],
                )
            except BaseException as e:
                if attempt < self.max_retries - 1:
                    delay = min(2 ** attempt, 30)
                    logger.warning(
                        "Change poll attempt %s/%s failed, retrying in %ss: %s",
                        attempt + 1,
                        self.max_retries,
                        delay,
                        e,
                    )
                    time.sleep(delay)
                    continue

                logger.error(
                    "Failed to fetch PICS changes after %s attempts: %s",
                    self.max_retries,
                    e,
                )
                raise RuntimeError(f"Failed to get PICS changes: {e}") from e
