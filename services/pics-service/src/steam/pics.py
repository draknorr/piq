"""PICS-specific operations for fetching Steam app data."""

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, Generator, List, Optional

import gevent

from .client import PICSSteamClient

logger = logging.getLogger(__name__)


def _cooperative_sleep(seconds: float) -> None:
    """Yield the Steam/gevent hub during delays and retry backoff."""

    gevent.sleep(seconds)


@dataclass
class PICSAppChange:
    """One app entry from a PICS changes-since response."""

    appid: int
    change_number: int
    needs_token: bool


@dataclass
class PICSChange:
    """Represents a PICS change notification."""

    change_number: int
    app_changes: List[int]
    package_changes: List[int]
    since_change_number: int = 0
    app_change_details: Optional[List[PICSAppChange]] = None
    force_full_update: bool = False
    force_full_app_update: bool = False
    force_full_package_update: bool = False


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
        self.last_product_info_attempts = 0
        self.last_change_poll_attempts = 0
        self.last_token_evidence_by_appid: Dict[int, Dict[str, Any]] = {}

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
        self.last_product_info_attempts = 0
        governed_request = getattr(self._client, "request_product_info", None)
        request_attempts = 1 if callable(governed_request) else self.max_retries
        for attempt in range(request_attempts):
            self.last_product_info_attempts = attempt + 1
            self._ensure_connection(wait_timeout=120)

            try:
                response = (
                    governed_request(appids, timeout=self.timeout)
                    if callable(governed_request)
                    else self._client.client.get_product_info(
                        apps=appids,
                        timeout=self.timeout,
                    )
                )

                if response is None:
                    logger.warning(
                        f"No response for batch starting at {appids[0] if appids else 'empty'}"
                    )
                    return {}

                return response.get("apps", {})
            except BaseException as e:
                # gevent.timeout.Timeout does not extend Exception.
                age = self._client.connection_age_seconds
                age_str = f"{age:.1f}s" if age is not None else "N/A"

                if attempt < request_attempts - 1:
                    delay = 2 ** (attempt + 1)  # 2, 4, 8 seconds
                    logger.warning(
                        f"Batch attempt {attempt + 1}/{request_attempts} failed "
                        f"(connection age: {age_str}), retrying in {delay}s: {e}"
                    )
                    _cooperative_sleep(delay)
                else:
                    logger.error(
                        f"Error fetching PICS data after {request_attempts} attempts "
                        f"(connection age: {age_str}): {e}"
                    )
                    raise

    def fetch_token_required_apps(self, appids: List[int]) -> Dict[int, Dict[str, Any]]:
        """Fetch only needs_token apps with explicit, cached access tokens."""

        bounded = sorted({int(appid) for appid in appids if int(appid) > 0})
        if len(bounded) > self.batch_size:
            raise ValueError(
                f"At most {self.batch_size} token-required apps may be fetched per batch"
            )
        self.last_token_evidence_by_appid = {}
        self.last_product_info_attempts = 0
        if not bounded:
            return {}
        self._ensure_connection(wait_timeout=120)

        tokens, evidence = self._client.acquire_access_tokens(bounded)

        self.last_token_evidence_by_appid.update(evidence)
        payloads: Dict[int, Dict[str, Any]] = {}
        request_appids = [appid for appid in bounded if appid in tokens]
        if request_appids:
            payloads.update(self._request_token_product_info(request_appids, tokens, evidence))

        rejected = [
            appid for appid in request_appids if bool(payloads.get(appid, {}).get("_missing_token"))
        ]
        if rejected:
            for appid in rejected:
                self._client.expire_access_token(appid)
            refreshed_tokens, refreshed_evidence = self._client.acquire_access_tokens(
                rejected,
                force_refresh=True,
            )
            self.last_token_evidence_by_appid.update(refreshed_evidence)
            refreshable = [appid for appid in rejected if appid in refreshed_tokens]
            payloads.update(
                self._request_token_product_info(
                    refreshable,
                    refreshed_tokens,
                    refreshed_evidence,
                )
            )
            for appid in rejected:
                if bool(payloads.get(appid, {}).get("_missing_token")):
                    payloads[appid] = self._missing_token_payload(
                        appid,
                        refreshed_evidence.get(
                            appid,
                            {"needsToken": True, "status": "unavailable"},
                        ),
                    )

        for appid in bounded:
            if appid in payloads:
                continue
            evidence_for_app = self.last_token_evidence_by_appid.get(
                appid,
                {"needsToken": True, "status": "unavailable"},
            )
            payloads[appid] = self._missing_token_payload(appid, evidence_for_app)
        return payloads

    def _request_token_product_info(
        self,
        appids: List[int],
        tokens: Dict[int, int],
        evidence: Dict[int, Dict[str, Any]],
    ) -> Dict[int, Dict[str, Any]]:
        if not appids:
            return {}
        self.last_product_info_attempts += 1
        response = self._client.request_product_info(
            [{"appid": appid, "access_token": tokens[appid]} for appid in appids],
            timeout=self.timeout,
        )
        raw_apps = response.get("apps", {}) if isinstance(response, dict) else {}
        result: Dict[int, Dict[str, Any]] = {}
        for appid in appids:
            raw_payload = raw_apps.get(appid)
            if not isinstance(raw_payload, dict):
                continue
            safe_payload = self._redact_access_tokens(raw_payload)
            safe_payload["_token_request"] = evidence.get(
                appid,
                {"needsToken": True, "status": "unknown"},
            )
            result[appid] = safe_payload
        return result

    @classmethod
    def _redact_access_tokens(cls, value: Any) -> Any:
        """Remove access-token keys before payloads can reach logs or archives."""

        if isinstance(value, dict):
            return {
                key: cls._redact_access_tokens(item)
                for key, item in value.items()
                if str(key).lower().replace("-", "_") not in {"access_token", "accesstoken"}
            }
        if isinstance(value, list):
            return [cls._redact_access_tokens(item) for item in value]
        return value

    def _missing_token_payload(
        self,
        appid: int,
        evidence: Dict[str, Any],
    ) -> Dict[str, Any]:
        self.last_token_evidence_by_appid[appid] = evidence
        return {
            "appid": appid,
            "_missing_token": True,
            "_token_request": evidence,
        }

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
                _cooperative_sleep(self.request_delay)

            except Exception as e:
                logger.error(f"Batch failed at offset {i} ({len(batch)} apps): {e}")
                failed_batches.append(batch)
                # Continue with next batch after delay
                _cooperative_sleep(2)

        # Log summary of failed batches
        if failed_batches:
            total_failed = sum(len(b) for b in failed_batches)
            failed_ids = [
                appid for batch in failed_batches for appid in batch[:5]
            ]  # First 5 from each
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
        self.last_change_poll_attempts = 0
        governed_request = getattr(self._client, "request_changes_since", None)
        request_attempts = 1 if callable(governed_request) else self.max_retries
        for attempt in range(request_attempts):
            self.last_change_poll_attempts = attempt + 1
            try:
                self._ensure_connection(wait_timeout=self.AUTO_RECONNECT_WAIT_TIMEOUT)
                timeout_error = TimeoutError(
                    f"PICS change poll timed out after {self.change_poll_timeout}s"
                )
                with gevent.Timeout(self.change_poll_timeout, timeout_error):
                    response = (
                        governed_request(
                            change_number,
                            app_changes=True,
                            package_changes=False,
                        )
                        if callable(governed_request)
                        else self._client.client.get_changes_since(
                            change_number,
                            app_changes=True,
                            package_changes=False,
                        )
                    )

                if response is None:
                    raise TimeoutError(
                        "PICS change poll returned no response before the client timeout"
                    )

                app_change_details = [
                    PICSAppChange(
                        appid=int(change.appid),
                        change_number=int(change.change_number),
                        needs_token=bool(change.needs_token),
                    )
                    for change in (response.app_changes or [])
                ]
                return PICSChange(
                    change_number=response.current_change_number,
                    app_changes=[change.appid for change in app_change_details],
                    package_changes=[],
                    since_change_number=int(response.since_change_number),
                    app_change_details=app_change_details,
                    force_full_update=bool(response.force_full_update),
                    force_full_app_update=bool(response.force_full_app_update),
                    force_full_package_update=bool(response.force_full_package_update),
                )
            except BaseException as e:
                if attempt < request_attempts - 1:
                    delay = min(2**attempt, 30)
                    logger.warning(
                        "Change poll attempt %s/%s failed, retrying in %ss: %s",
                        attempt + 1,
                        request_attempts,
                        delay,
                        e,
                    )
                    _cooperative_sleep(delay)
                    continue

                logger.error(
                    "Failed to fetch PICS changes after %s attempts: %s",
                    request_attempts,
                    e,
                )
                raise RuntimeError(f"Failed to get PICS changes: {e}") from e
