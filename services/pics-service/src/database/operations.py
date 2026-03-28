"""Database operations for PICS data."""

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Set, TypeVar

import httpx

from .client import SupabaseClient
from .change_intelligence import (
    PICS_CHANGE_SOURCE,
    PICS_SNAPSHOT_SOURCE,
    diff_pics_snapshots,
    hash_normalized_snapshot,
    normalize_pics_snapshot,
)
from ..extractors.common import ExtractedPICSData, Association

logger = logging.getLogger(__name__)
T = TypeVar("T")

STEAM_TAGS_URL = "https://store.steampowered.com/tagdata/populartags/english"

# Genre ID → Name mapping (from Steam PICS data)
GENRE_NAMES: Dict[int, str] = {
    1: "Action",
    2: "Strategy",
    3: "RPG",
    4: "Casual",
    5: "Racing",
    9: "Racing",
    12: "Sports",
    18: "Sports",
    23: "Indie",
    25: "Adventure",
    28: "Simulation",
    29: "Massively Multiplayer",
    37: "Free to Play",
    51: "Animation & Modeling",
    53: "Design & Illustration",
    54: "Education",
    55: "Software Training",
    56: "Utilities",
    57: "Video Production",
    58: "Web Publishing",
    59: "Game Development",
    60: "Photo Editing",
    70: "Early Access",
    71: "Audio Production",
    72: "Accounting",
    81: "Documentary",
    82: "Episodic",
    83: "Feature Film",
    84: "Short",
    85: "Benchmark",
    86: "VR",
    87: "360 Video",
}

# Category ID → Name mapping (Steam feature categories)
# Gathered from Steam Storefront API calls on 30+ games
CATEGORY_NAMES: Dict[int, str] = {
    # Core gameplay modes
    1: "Multi-player",
    2: "Single-player",
    6: "Mods (require HL2)",
    8: "Valve Anti-Cheat enabled",
    9: "Co-op",
    # Steam features
    13: "Captions available",
    14: "Commentary available",
    15: "Stats",
    16: "Includes Source SDK",
    17: "Includes level editor",
    18: "Partial Controller Support",
    19: "Mods",
    20: "MMO",
    21: "Downloadable Content",
    22: "Steam Achievements",
    23: "Steam Cloud",
    24: "Shared/Split Screen",
    25: "Steam Leaderboards",
    # Multiplayer features
    27: "Cross-Platform Multiplayer",
    28: "Full controller support",
    29: "Steam Trading Cards",
    30: "Steam Workshop",
    31: "VR Support",
    32: "Steam Turn Notifications",
    35: "In-App Purchases",
    36: "Online PvP",
    37: "Shared/Split Screen PvP",
    38: "Online Co-op",
    39: "Shared/Split Screen Co-op",
    40: "SteamVR Collectibles",
    41: "Remote Play on Phone",
    42: "Remote Play on Tablet",
    43: "Remote Play on TV",
    44: "Remote Play Together",
    45: "Captions available",
    46: "LAN PvP",
    47: "LAN Co-op",
    48: "LAN Co-op",
    49: "PvP",
    50: "VR Only",
    51: "Steam Workshop",
    52: "Tracked Controller Support",
    53: "VR Supported",
    54: "VR Only",
    # HDR and new features
    55: "Timeline Support",
    56: "GPU Recording",
    57: "Cloud Gaming",
    58: "Steam Input API",
    59: "Co-op Campaigns",
    60: "Steam Overlay Support",
    61: "HDR available",
    62: "Family Sharing",
    63: "Steam Timeline",
    # Accessibility features
    64: "Adjustable Text Size",
    65: "Subtitle Options",
    66: "Color Alternatives",
    67: "Camera Comfort",
    68: "Custom Volume Controls",
    69: "Stereo Sound",
    70: "Surround Sound",
    71: "Narrated Game Menus",
    72: "Chat Speech-to-text",
    74: "Playable without Timed Input",
    75: "Keyboard Only Option",
    76: "Mouse Only Option",
    77: "Touch Only Option",
    78: "Adjustable Difficulty",
    79: "Save Anytime",
}


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if not isinstance(value, str) or not value:
        return None

    normalized = value.replace("Z", "+00:00")

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)

    return parsed


def _parse_iso_date(value: Any) -> Optional[date]:
    if not isinstance(value, str) or not value:
        return None

    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def _extract_related_app(row: Dict[str, Any]) -> Dict[str, Any]:
    app_data = row.get("apps")
    if isinstance(app_data, list):
        return app_data[0] if app_data else {}
    if isinstance(app_data, dict):
        return app_data
    return {}


def select_first_pass_app_ids(
    rows: List[Dict[str, Any]],
    limit: int,
    recent_release_days: int,
    near_release_days: int,
    today: Optional[date] = None,
) -> List[int]:
    effective_limit = max(1, limit)
    effective_today = today or datetime.now(timezone.utc).date()
    recent_cutoff = effective_today - timedelta(days=max(1, recent_release_days))
    near_release_cutoff = effective_today + timedelta(days=max(1, near_release_days))
    ranked: List[tuple[tuple[int, float, int], int]] = []

    for row in rows:
        appid = row.get("appid")
        last_storefront_sync = _parse_iso_datetime(row.get("last_storefront_sync"))

        if not isinstance(appid, int) or appid <= 0 or last_storefront_sync is None:
            continue

        if row.get("storefront_accessible") is False:
            continue

        app_data = _extract_related_app(row)
        release_date = _parse_iso_date(app_data.get("release_date"))
        is_released = bool(app_data.get("is_released"))

        if is_released and release_date is not None and release_date >= recent_cutoff:
            bucket = 0
        elif release_date is not None and effective_today <= release_date <= near_release_cutoff:
            bucket = 1
        elif is_released:
            bucket = 2
        else:
            bucket = 3

        ranked.append(((bucket, -last_storefront_sync.timestamp(), appid), appid))

    ranked.sort(key=lambda item: item[0])
    return [appid for _, appid in ranked[:effective_limit]]


class PICSDatabase:
    """Database operations for PICS data."""

    UPSERT_BATCH_SIZE = 500
    HISTORY_MAX_RETRIES = 3
    HISTORY_RETRY_DELAY_SECONDS = 1.0
    HISTORY_FAILURE_COOLDOWN_SECONDS = 60.0
    _tag_name_cache: Dict[int, str] = {}  # Class-level cache

    def __init__(self):
        self._db = SupabaseClient.get_instance()
        self._load_tag_names()
        self._history_available = True
        self._history_disabled_until: Optional[float] = None

    def _load_tag_names(self):
        """Load Steam tag names from API (cached at class level)."""
        if PICSDatabase._tag_name_cache:
            return  # Already loaded

        try:
            logger.info("Loading Steam tag names from API...")
            response = httpx.get(STEAM_TAGS_URL, timeout=30.0)
            response.raise_for_status()
            tags = response.json()
            PICSDatabase._tag_name_cache = {t["tagid"]: t["name"] for t in tags}
            logger.info(f"Loaded {len(PICSDatabase._tag_name_cache)} Steam tag names")
        except Exception as e:
            logger.warning(f"Failed to load Steam tag names: {e}")

    def _get_tag_name(self, tag_id: int) -> str:
        """Get tag name from cache, or fallback to placeholder."""
        return PICSDatabase._tag_name_cache.get(tag_id, f"Tag {tag_id}")

    def upsert_apps_batch(
        self,
        apps: List[ExtractedPICSData],
        trigger_reason: str = "bulk_sync",
        trigger_cursor: Optional[str] = None,
    ) -> Dict[str, int]:
        """
        Upsert a batch of apps with their relationships.

        Only processes apps that already exist in the database (from applist-worker).
        This prevents FK violations when change_monitor receives notifications for
        apps that haven't been synced yet.

        Returns stats dict with created/updated/failed/skipped counts.
        """
        stats = {"created": 0, "updated": 0, "failed": 0, "skipped": 0}

        if not apps:
            return stats

        # Get existing appids from database - only process apps that exist
        all_appids = [app.appid for app in apps]
        existing_appids = set(self._get_existing_appids(all_appids))

        # Filter to only apps that exist in database
        apps_to_process = [app for app in apps if app.appid in existing_appids]
        skipped_apps = [app for app in apps if app.appid not in existing_appids]
        stats["skipped"] = len(skipped_apps)

        if skipped_apps:
            skipped_sample = [a.appid for a in skipped_apps[:10]]
            logger.warning(
                f"Skipping {len(skipped_apps)} apps not in database: {skipped_sample}"
                + ("..." if len(skipped_apps) > 10 else "")
            )

        if not apps_to_process:
            logger.info("No apps to process after filtering - all apps not in database")
            return stats

        # Capture normalized snapshot history before mutating latest-state tables.
        self._capture_change_history(apps_to_process, trigger_reason=trigger_reason, trigger_cursor=trigger_cursor)

        # Get apps that already have storefront release dates (authoritative)
        # PICS should only set release_date as a fallback when storefront data is missing
        appids_to_process = [app.appid for app in apps_to_process]
        apps_with_storefront_dates = self._get_apps_with_storefront_dates(appids_to_process)
        logger.info(f"{len(apps_with_storefront_dates)} apps have storefront release dates (will not overwrite)")

        # Get apps that have been synced via storefront API (authoritative for is_free)
        # PICS should only set is_free as a fallback when storefront hasn't synced yet
        apps_with_storefront_sync = self._get_apps_with_storefront_sync(appids_to_process)
        logger.info(f"{len(apps_with_storefront_sync)} apps have storefront sync (will not overwrite is_free)")

        # Prepare app records
        app_records = []
        appid_to_app = {}  # Track which apps we're processing
        build_failures = 0
        for app in apps_to_process:
            has_storefront_date = app.appid in apps_with_storefront_dates
            has_storefront_sync = app.appid in apps_with_storefront_sync
            record = self._build_app_record(app, has_storefront_date=has_storefront_date, has_storefront_sync=has_storefront_sync)
            if record:
                app_records.append(record)
                appid_to_app[app.appid] = app
            else:
                build_failures += 1

        logger.info(
            f"Built {len(app_records)} records from {len(apps_to_process)} apps "
            f"({build_failures} build failures, {stats['skipped']} skipped)"
        )

        # Track successfully upserted appids
        successful_appids = set()

        # Upsert apps in batches
        for i in range(0, len(app_records), self.UPSERT_BATCH_SIZE):
            batch = app_records[i : i + self.UPSERT_BATCH_SIZE]
            batch_appids = {r["appid"] for r in batch}
            try:
                self._db.client.table("apps").upsert(batch, on_conflict="appid").execute()
                stats["updated"] += len(batch)
                successful_appids.update(batch_appids)
            except Exception as e:
                logger.error(f"Failed to upsert app batch: {e}")
                stats["failed"] += len(batch)

        # Process relationships only for successfully upserted apps
        successful_apps = [appid_to_app[appid] for appid in successful_appids if appid in appid_to_app]
        self._sync_relationships(successful_apps, successful_appids, trigger_cursor=trigger_cursor)

        return stats

    def _get_existing_appids(self, appids: List[int]) -> List[int]:
        """Check which appids already exist in the apps table."""
        if not appids:
            return []

        existing = []
        batch_size = 1000  # Supabase limit

        for i in range(0, len(appids), batch_size):
            batch = appids[i : i + batch_size]
            try:
                result = (
                    self._db.client.table("apps")
                    .select("appid")
                    .in_("appid", batch)
                    .execute()
                )
                existing.extend([r["appid"] for r in result.data])
            except Exception as e:
                logger.error(f"Failed to check existing appids: {e}")

        return existing

    def _get_apps_with_storefront_dates(self, appids: List[int]) -> Set[int]:
        """Get appids that have release_date_raw from storefront (authoritative).

        The storefront API provides authoritative release dates. PICS should only
        set release_date as a fallback when storefront data is not available.
        """
        if not appids:
            return set()

        has_raw_date: Set[int] = set()
        batch_size = 1000

        for i in range(0, len(appids), batch_size):
            batch = appids[i : i + batch_size]
            try:
                result = (
                    self._db.client.table("apps")
                    .select("appid")
                    .in_("appid", batch)
                    .not_.is_("release_date_raw", "null")
                    .execute()
                )
                has_raw_date.update(r["appid"] for r in result.data)
            except Exception as e:
                logger.error(f"Failed to check storefront dates: {e}")

        return has_raw_date

    def _get_apps_with_storefront_sync(self, appids: List[int]) -> Set[int]:
        """Get appids that have been synced via storefront API.

        The storefront API is authoritative for is_free. PICS should only
        set is_free as a fallback when storefront hasn't synced the app yet.
        """
        if not appids:
            return set()

        has_storefront_sync: Set[int] = set()
        batch_size = 1000

        for i in range(0, len(appids), batch_size):
            batch = appids[i : i + batch_size]
            try:
                result = (
                    self._db.client.table("sync_status")
                    .select("appid")
                    .in_("appid", batch)
                    .not_.is_("last_storefront_sync", "null")
                    .execute()
                )
                has_storefront_sync.update(r["appid"] for r in result.data)
            except Exception as e:
                logger.error(f"Failed to check storefront sync status: {e}")

        return has_storefront_sync

    def _capture_change_history(
        self,
        apps: List[ExtractedPICSData],
        trigger_reason: str,
        trigger_cursor: Optional[str],
    ) -> None:
        """Persist normalized PICS snapshots and diff events before latest-state writes."""
        if not apps or not self._is_history_capture_enabled():
            return

        observed_at = datetime.utcnow().isoformat()
        latest_snapshots = self._get_latest_history_snapshots([app.appid for app in apps])
        if latest_snapshots is None:
            return

        unchanged_snapshot_ids: List[int] = []
        snapshot_rows: List[Dict[str, Any]] = []
        pending_events: Dict[int, Dict[str, Any]] = {}

        for app in apps:
            normalized = normalize_pics_snapshot(app)
            content_hash = hash_normalized_snapshot(normalized)
            previous = latest_snapshots.get(app.appid)

            if previous and previous.get("content_hash") == content_hash:
                previous_id = previous.get("id")
                if previous_id:
                    unchanged_snapshot_ids.append(int(previous_id))
                continue

            snapshot_rows.append(
                {
                    "appid": app.appid,
                    "source": PICS_SNAPSHOT_SOURCE,
                    "observed_at": observed_at,
                    "first_seen_at": observed_at,
                    "last_seen_at": observed_at,
                    "content_hash": content_hash,
                    "previous_snapshot_id": previous.get("id") if previous else None,
                    "trigger_reason": trigger_reason,
                    "trigger_cursor": trigger_cursor,
                    "snapshot_data": normalized,
                }
            )
            pending_events[app.appid] = {
                "previous": previous,
                "normalized": normalized,
                "trigger_cursor": trigger_cursor,
                "observed_at": observed_at,
            }

        if unchanged_snapshot_ids:
            self._update_last_seen_snapshots(unchanged_snapshot_ids, observed_at)
            if not self._history_available:
                return

        if not snapshot_rows:
            return

        inserted_snapshots = self._insert_history_snapshots(snapshot_rows)
        if inserted_snapshots is None:
            return

        event_rows: List[Dict[str, Any]] = []
        for snapshot in inserted_snapshots:
            appid = int(snapshot["appid"])
            snapshot_id = int(snapshot["id"])
            pending = pending_events.get(appid)
            if not pending:
                continue

            previous = pending["previous"]
            if not previous:
                continue

            diff_events = diff_pics_snapshots(previous["snapshot_data"], pending["normalized"])
            for event in diff_events:
                event_rows.append(
                    {
                        "appid": appid,
                        "source": PICS_CHANGE_SOURCE,
                        "change_type": event.change_type,
                        "occurred_at": pending["observed_at"],
                        "source_snapshot_id": snapshot_id,
                        "related_snapshot_id": previous.get("id"),
                        "before_value": event.before_value,
                        "after_value": event.after_value,
                        "context": event.context,
                        "trigger_cursor": pending["trigger_cursor"],
                    }
                )

        if event_rows:
            self._insert_change_events(event_rows)

    def _get_latest_history_snapshots(self, appids: List[int]) -> Optional[Dict[int, Dict[str, Any]]]:
        """Fetch the latest stored PICS snapshot per app."""
        latest_by_appid: Dict[int, Dict[str, Any]] = {}
        batch_size = 200

        for i in range(0, len(appids), batch_size):
            batch = appids[i : i + batch_size]
            result = self._run_history_operation(
                "query PICS history snapshots",
                lambda batch=batch: (
                    self._db.client.table("app_source_snapshots")
                    .select("id, appid, content_hash, snapshot_data, first_seen_at")
                    .eq("source", PICS_SNAPSHOT_SOURCE)
                    .in_("appid", batch)
                    .order("appid")
                    .order("first_seen_at", desc=True)
                    .execute()
                ),
                retry_policy="transient",
            )
            if result is None:
                return None

            for row in result.data or []:
                appid = int(row["appid"])
                if appid not in latest_by_appid:
                    latest_by_appid[appid] = row

        return latest_by_appid

    def _update_last_seen_snapshots(self, snapshot_ids: List[int], observed_at: str) -> None:
        """Extend last_seen_at for unchanged snapshots."""
        for snapshot_id in snapshot_ids:
            result = self._run_history_operation(
                f"update last_seen_at for snapshot {snapshot_id}",
                lambda snapshot_id=snapshot_id: (
                    self._db.client.table("app_source_snapshots")
                    .update({"last_seen_at": observed_at, "observed_at": observed_at})
                    .eq("id", snapshot_id)
                    .execute()
                ),
                retry_policy="transient",
            )
            if result is None:
                return

    def _insert_history_snapshots(self, snapshot_rows: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
        """Insert new PICS history snapshots in batches."""
        inserted_rows: List[Dict[str, Any]] = []

        for i in range(0, len(snapshot_rows), self.UPSERT_BATCH_SIZE):
            batch = snapshot_rows[i : i + self.UPSERT_BATCH_SIZE]
            result = self._run_history_operation(
                "insert PICS history snapshots",
                lambda batch=batch: self._db.client.table("app_source_snapshots").insert(batch).execute(),
                retry_policy="schema_cache_only",
            )
            if result is None:
                return None

            inserted_rows.extend(result.data or [])

        return inserted_rows

    def _insert_change_events(self, event_rows: List[Dict[str, Any]]) -> None:
        """Insert structured PICS change events in batches."""
        for i in range(0, len(event_rows), self.UPSERT_BATCH_SIZE):
            batch = event_rows[i : i + self.UPSERT_BATCH_SIZE]
            result = self._run_history_operation(
                "insert PICS change events",
                lambda batch=batch: self._db.client.table("app_change_events").insert(batch).execute(),
                retry_policy="schema_cache_only",
            )
            if result is None:
                return

    def _disable_history_capture(self, reason: str) -> None:
        """Trip a cooldown circuit breaker after repeated history failures."""
        cooldown_until = time.monotonic() + self.HISTORY_FAILURE_COOLDOWN_SECONDS
        already_disabled = not self._history_available
        self._history_available = False
        self._history_disabled_until = cooldown_until

        if already_disabled:
            return

        logger.warning(
            "Disabling PICS change history capture for this process for %.0fs: %s",
            self.HISTORY_FAILURE_COOLDOWN_SECONDS,
            reason,
        )

    def _is_history_capture_enabled(self) -> bool:
        """Allow history capture after the cooldown window expires."""
        if self._history_available:
            return True

        if self._history_disabled_until is None:
            return False

        if time.monotonic() < self._history_disabled_until:
            return False

        logger.info("Re-enabling PICS change history capture after cooldown")
        self._history_available = True
        self._history_disabled_until = None
        return True

    def _run_history_operation(
        self,
        operation_name: str,
        operation: Callable[[], T],
        retry_policy: str,
    ) -> Optional[T]:
        """Run a history operation with bounded retries and cooldown on failure."""
        last_error: Optional[Exception] = None

        for attempt in range(1, self.HISTORY_MAX_RETRIES + 1):
            try:
                result = operation()
                self._record_history_success()
                return result
            except Exception as error:
                last_error = error
                if not self._should_retry_history_error(error, retry_policy, attempt):
                    break

                logger.warning(
                    "Retrying PICS change history %s after transient failure (%s/%s): %s",
                    operation_name,
                    attempt,
                    self.HISTORY_MAX_RETRIES,
                    error,
                )
                time.sleep(self.HISTORY_RETRY_DELAY_SECONDS * attempt)

        self._disable_history_capture(
            f"Failed to {operation_name} after {self.HISTORY_MAX_RETRIES} attempts: {last_error}"
            if last_error is not None
            else f"Failed to {operation_name}"
        )
        return None

    def _record_history_success(self) -> None:
        """Reset cooldown state after a successful history operation."""
        self._history_available = True
        self._history_disabled_until = None

    def _should_retry_history_error(self, error: Exception, retry_policy: str, attempt: int) -> bool:
        """Retry only when the failure type is safe for the specific operation."""
        if attempt >= self.HISTORY_MAX_RETRIES:
            return False

        if self._is_history_schema_cache_error(error):
            return True

        return retry_policy == "transient" and self._is_history_transient_error(error)

    def _is_history_transient_error(self, error: Exception) -> bool:
        """Treat network and timeout errors as transient for idempotent history operations."""
        if isinstance(error, (httpx.TimeoutException, httpx.TransportError, httpx.NetworkError)):
            return True

        message = self._history_error_text(error)
        transient_markers = (
            "timeout",
            "timed out",
            "connection reset",
            "connection aborted",
            "connection refused",
            "server disconnected",
            "temporarily unavailable",
            "502",
            "503",
            "504",
        )
        return any(marker in message for marker in transient_markers)

    def _is_history_schema_cache_error(self, error: Exception) -> bool:
        """Detect transient PostgREST schema cache misses."""
        payload = self._history_error_payload(error)
        if payload.get("code") == "PGRST205":
            return True

        message = self._history_error_text(error)
        return "schema cache" in message or "could not find the table" in message

    def _history_error_payload(self, error: Exception) -> Dict[str, Any]:
        """Extract structured error payloads from Supabase client exceptions when present."""
        if error.args and isinstance(error.args[0], dict):
            return error.args[0]
        return {}

    def _history_error_text(self, error: Exception) -> str:
        """Normalize exception text for retry classification."""
        payload = self._history_error_payload(error)
        parts = [str(error)]
        for key in ("message", "hint", "details", "code"):
            value = payload.get(key)
            if value:
                parts.append(str(value))
        return " ".join(parts).lower()

    def _build_app_record(self, app: ExtractedPICSData, has_storefront_date: bool = False, has_storefront_sync: bool = False) -> Optional[Dict[str, Any]]:
        """Build a database record from extracted PICS data."""
        try:
            # Use PICS type if available, otherwise infer from other data
            app_type = app.type if app.type else self._infer_type(app)

            return {
                "appid": app.appid,
                # Only update name if it exists (don't overwrite with None)
                **({"name": app.name} if app.name else {}),
                # Always set type - either from PICS or inferred
                "type": self._map_app_type(app_type),
                # PICS-specific fields
                "pics_review_score": app.review_score,
                "pics_review_percentage": app.review_percentage,
                "controller_support": app.controller_support,
                "metacritic_score": app.metacritic_score,
                "metacritic_url": app.metacritic_url,
                "platforms": ",".join(app.platforms) if app.platforms else None,
                "release_state": app.release_state,
                # NOTE: parent_appid removed - PICS common.parent is unreliable (contains garbage)
                # Parent relationships are now only set via Storefront API's fullgame field
                "homepage_url": app.homepage_url,
                "app_state": app.app_state,
                "last_content_update": (
                    app.last_update_timestamp.isoformat() if app.last_update_timestamp else None
                ),
                "store_asset_mtime": (
                    app.store_asset_mtime.date().isoformat() if app.store_asset_mtime else None
                ),
                "current_build_id": app.current_build_id,
                "content_descriptors": app.content_descriptors if app.content_descriptors else None,
                "languages": app.languages if app.languages else None,
                "has_workshop": app.has_workshop,
                # is_free from PICS - only as fallback when storefront hasn't synced yet
                # Storefront API is authoritative for is_free
                **({"is_free": app.is_free} if not has_storefront_sync else {}),
                # Release date from PICS - only as fallback when storefront data is missing
                # Storefront API is authoritative for release dates
                **(
                    {"release_date": app.steam_release_date.date().isoformat()}
                    if app.steam_release_date and not has_storefront_date
                    else {}
                ),
                # is_released from PICS - only as fallback when storefront hasn't synced yet
                # Storefront API is authoritative for is_released (uses reliable coming_soon field)
                **({"is_released": app.release_state == "released"} if not has_storefront_sync else {}),
                "updated_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Failed to build record for app {app.appid}: {e}")
            return None

    def _sync_relationships(
        self,
        apps: List[ExtractedPICSData],
        successful_appids: Set[int],
        trigger_cursor: Optional[str] = None,
    ):
        """Sync developer/publisher/tag/genre/category/franchise relationships.

        Only processes apps in the successful_appids set to avoid FK violations
        when updating sync_status for apps that failed to upsert.
        """
        processed_appids = []

        for app in apps:
            # Only process apps that were successfully upserted
            if app.appid not in successful_appids:
                continue

            try:
                # Steam Deck compatibility
                if app.steam_deck:
                    self._upsert_steam_deck(app.appid, app.steam_deck)

                # Categories
                self._sync_categories(app.appid, app.categories)

                # Genres
                self._sync_genres(app.appid, app.genres, app.primary_genre)

                # Store tags
                self._sync_store_tags(app.appid, app.store_tags)

                # Franchises from associations
                franchises = [a for a in app.associations if a.type == "franchise"]
                for franchise in franchises:
                    self._upsert_franchise_link(app.appid, franchise.name)

                # DLC relationships (from listofdlc field)
                if app.dlc_appids:
                    self._sync_dlc_relationships(app.appid, app.dlc_appids)

                # Mark as successfully processed
                processed_appids.append(app.appid)

            except Exception as e:
                logger.error(f"Failed to sync relationships for app {app.appid}: {e}")

        # Batch update sync status only for successfully processed apps
        if processed_appids:
            self._batch_update_sync_status(processed_appids, trigger_cursor=trigger_cursor)

    def _upsert_steam_deck(self, appid: int, deck: "SteamDeckCompatibility"):
        """Upsert Steam Deck compatibility data."""
        from ..extractors.common import SteamDeckCompatibility

        category_map = {0: "unknown", 1: "unsupported", 2: "playable", 3: "verified"}

        try:
            self._db.client.table("app_steam_deck").upsert(
                {
                    "appid": appid,
                    "category": category_map.get(deck.category, "unknown"),
                    "test_timestamp": (
                        datetime.fromtimestamp(deck.test_timestamp).isoformat()
                        if deck.test_timestamp
                        else None
                    ),
                    "tested_build_id": deck.tested_build_id,
                    "tests": deck.tests,
                    "updated_at": datetime.utcnow().isoformat(),
                },
                on_conflict="appid",
            ).execute()
        except Exception as e:
            logger.error(f"Failed to upsert Steam Deck data for {appid}: {e}")

    def _sync_categories(self, appid: int, categories: Dict[int, bool]):
        """Sync app categories."""
        try:
            enabled_cat_ids = sorted({cat_id for cat_id, enabled in (categories or {}).items() if enabled})

            if enabled_cat_ids:
                cat_records = [
                    {"category_id": cat_id, "name": CATEGORY_NAMES.get(cat_id, f"Category {cat_id}")}
                    for cat_id in enabled_cat_ids
                ]
                self._db.client.table("steam_categories").upsert(cat_records, on_conflict="category_id").execute()

            self._db.client.rpc(
                "replace_app_categories",
                {"p_appid": appid, "p_category_ids": enabled_cat_ids},
            ).execute()
        except Exception as e:
            logger.error(f"Failed to sync categories for {appid}: {e}")

    def _sync_genres(self, appid: int, genres: List[int], primary_genre: Optional[int]):
        """Sync app genres."""
        try:
            desired_genres = list(dict.fromkeys(genre_id for genre_id in (genres or []) if genre_id is not None))

            if desired_genres:
                genre_records = [
                    {"genre_id": genre_id, "name": GENRE_NAMES.get(genre_id, f"Genre {genre_id}")}
                    for genre_id in desired_genres
                ]
                self._db.client.table("steam_genres").upsert(genre_records, on_conflict="genre_id").execute()

            self._db.client.rpc(
                "replace_app_genres",
                {
                    "p_appid": appid,
                    "p_genre_ids": desired_genres,
                    "p_primary_genre_id": primary_genre,
                },
            ).execute()
        except Exception as e:
            logger.error(f"Failed to sync genres for {appid}: {e}")

    def _sync_store_tags(self, appid: int, tag_ids: List[int]):
        """Sync store tags for an app."""
        try:
            ordered_tag_ids = list(dict.fromkeys(tag_id for tag_id in (tag_ids or []) if tag_id is not None))

            if ordered_tag_ids:
                now = datetime.utcnow().isoformat()
                tag_records = [
                    {"tag_id": tag_id, "name": self._get_tag_name(tag_id), "updated_at": now}
                    for tag_id in ordered_tag_ids
                ]
                self._db.client.table("steam_tags").upsert(tag_records, on_conflict="tag_id").execute()

            self._db.client.rpc(
                "replace_app_steam_tags",
                {"p_appid": appid, "p_tag_ids": ordered_tag_ids},
            ).execute()
        except Exception as e:
            logger.error(f"Failed to sync store tags for {appid}: {e}")

    def _upsert_franchise_link(self, appid: int, franchise_name: str):
        """Create/update franchise and link to app."""
        try:
            # Upsert franchise
            result = self._db.client.rpc("upsert_franchise", {"p_name": franchise_name}).execute()
            franchise_id = result.data

            if franchise_id:
                # Link to app
                self._db.client.table("app_franchises").upsert(
                    {"appid": appid, "franchise_id": franchise_id},
                    on_conflict="appid,franchise_id",
                ).execute()
        except Exception as e:
            logger.error(f"Failed to link franchise {franchise_name} to {appid}: {e}")

    def _sync_dlc_relationships(self, parent_appid: int, dlc_appids: List[int]):
        """Sync DLC relationships from PICS listofdlc field to junction table.

        Note: FK constraints have been removed from app_dlc table to allow
        relationships to be stored even when DLC apps don't exist yet.
        This handles the case where processing order is unpredictable.
        """
        if not dlc_appids:
            return

        try:
            records = [
                {"parent_appid": parent_appid, "dlc_appid": dlc_id, "source": "pics"}
                for dlc_id in dlc_appids
            ]
            self._db.client.table("app_dlc").upsert(
                records,
                on_conflict="parent_appid,dlc_appid",
            ).execute()
            logger.info(f"Synced {len(dlc_appids)} DLC relationships for app {parent_appid}")
        except Exception as e:
            logger.error(f"Failed to sync DLC relationships for {parent_appid}: {e}")

    def _update_sync_status(self, appid: int, trigger_cursor: Optional[str] = None):
        """Update sync status for an app."""
        try:
            self._db.client.table("sync_status").upsert(
                {
                    "appid": appid,
                    "last_pics_sync": datetime.utcnow().isoformat(),
                    **({"pics_change_number": int(trigger_cursor)} if trigger_cursor else {}),
                },
                on_conflict="appid",
            ).execute()
        except Exception as e:
            logger.error(f"Failed to update sync status for {appid}: {e}")

    def _batch_update_sync_status(self, appids: List[int], trigger_cursor: Optional[str] = None):
        """Batch update sync status for multiple apps."""
        if not appids:
            return

        now = datetime.utcnow().isoformat()
        batch_size = 500  # Supabase batch limit

        for i in range(0, len(appids), batch_size):
            batch = appids[i : i + batch_size]
            records = [
                {
                    "appid": appid,
                    "last_pics_sync": now,
                    **({"pics_change_number": int(trigger_cursor)} if trigger_cursor else {}),
                }
                for appid in batch
            ]

            try:
                self._db.client.table("sync_status").upsert(
                    records,
                    on_conflict="appid",
                ).execute()
                logger.debug(f"Updated sync status for {len(batch)} apps")
            except Exception as e:
                logger.error(f"Failed to batch update sync status ({len(batch)} apps): {e}")
                # Fallback to individual updates for this batch
                for appid in batch:
                    self._update_sync_status(appid, trigger_cursor=trigger_cursor)

    def _infer_type(self, app: ExtractedPICSData) -> str:
        """Infer app type when PICS doesn't provide it.

        Uses heuristics based on available data:
        - Name contains "Demo" → demo
        - Name contains "Soundtrack" → music
        - Name contains "SDK" → tool

        NOTE: DLC detection removed - PICS parent_appid is unreliable (contains garbage).
        DLC type is now ONLY set via Storefront API's fullgame field.
        """
        # Infer from name patterns
        if app.name:
            name_lower = app.name.lower()

            # Demo patterns (but not "Demon", "Democracy", etc.)
            if (
                " demo" in name_lower
                or name_lower.endswith(" demo")
                or "(demo)" in name_lower
                or "[demo]" in name_lower
            ):
                if not any(x in name_lower for x in ["demon", "democracy", "demolition"]):
                    return "demo"

            # Music/Soundtrack patterns
            if any(x in name_lower for x in ["soundtrack", " ost", "original score", "music pack"]):
                return "music"

            # Tool patterns
            if any(x in name_lower for x in [" sdk", "dedicated server", "level editor", "modding tool"]):
                return "tool"

            # Video patterns
            if any(x in name_lower for x in ["trailer", "- video", "making of", "behind the scenes"]):
                return "video"

        return "game"  # Default fallback

    def _map_app_type(self, pics_type: Optional[str]) -> str:
        """Map PICS type to database enum."""
        if not pics_type:
            return "game"
        type_map = {
            "game": "game",
            "dlc": "dlc",
            "demo": "demo",
            "mod": "mod",
            "video": "video",
            "tool": "tool",
            "application": "application",
            "hardware": "hardware",
            "music": "music",
            "episode": "episode",
            "series": "series",
            "advertising": "advertising",
        }
        return type_map.get(pics_type.lower(), "game")

    def get_all_app_ids(self, unsynced_only: bool = False) -> List[int]:
        """Get list of app IDs from database.

        Args:
            unsynced_only: If True, only return apps that haven't been PICS synced yet.
        """
        if unsynced_only:
            # Paginate through unsynced apps (Supabase limits to 1000 per request)
            return self._get_unsynced_app_ids_paginated()
        else:
            return self._get_all_app_ids_paginated()

    def get_first_pass_app_ids(
        self,
        limit: int,
        candidate_pool_size: int,
        recent_release_days: int,
        near_release_days: int,
    ) -> List[int]:
        """Get prioritized unsynced app IDs for first-pass PICS capture."""
        effective_limit = max(1, limit)
        effective_pool_size = max(effective_limit, min(max(candidate_pool_size, effective_limit), 1000))

        try:
            result = (
                self._db.client.table("sync_status")
                .select(
                    "appid,last_pics_sync,last_storefront_sync,storefront_accessible,"
                    "apps!inner(release_date,is_released)"
                )
                .is_("last_pics_sync", "null")
                .not_.is_("last_storefront_sync", "null")
                .order("last_storefront_sync", desc=True)
                .limit(effective_pool_size)
                .execute()
            )
        except Exception as e:
            logger.error(f"Failed to fetch first-pass PICS candidates: {e}")
            return []

        selected = select_first_pass_app_ids(
            result.data or [],
            limit=effective_limit,
            recent_release_days=recent_release_days,
            near_release_days=near_release_days,
        )
        logger.info(
            "Selected %s prioritized first-pass PICS app IDs from %s candidates",
            len(selected),
            len(result.data or []),
        )
        return selected

    def _get_unsynced_app_ids_paginated(self) -> List[int]:
        """Get all unsynced app IDs with cursor-based pagination."""
        all_appids = []
        page_size = 1000  # Supabase hard limit
        last_appid = 0

        while True:
            try:
                # Use cursor-based pagination (gt) instead of offset/range
                # Supabase caps range() at 1000 rows regardless of what you specify
                result = (
                    self._db.client.table("sync_status")
                    .select("appid")
                    .is_("last_pics_sync", "null")
                    .gt("appid", last_appid)
                    .order("appid")
                    .limit(page_size)
                    .execute()
                )

                if not result.data:
                    break

                appids = [r["appid"] for r in result.data]
                all_appids.extend(appids)
                last_appid = appids[-1]  # Cursor for next page
                logger.info(f"Fetched {len(appids)} unsynced app IDs (total: {len(all_appids)})")

                if len(appids) < page_size:
                    break

            except Exception as e:
                logger.error(f"Failed to fetch unsynced app IDs after appid {last_appid}: {e}")
                break

        logger.info(f"Total unsynced apps to process: {len(all_appids)}")
        return all_appids

    def _get_all_app_ids_paginated(self) -> List[int]:
        """Get all app IDs with cursor-based pagination."""
        all_appids = []
        page_size = 1000  # Supabase hard limit
        last_appid = 0

        while True:
            try:
                result = (
                    self._db.client.table("apps")
                    .select("appid")
                    .gt("appid", last_appid)
                    .order("appid")
                    .limit(page_size)
                    .execute()
                )

                if not result.data:
                    break

                appids = [r["appid"] for r in result.data]
                all_appids.extend(appids)
                last_appid = appids[-1]

                if len(appids) < page_size:
                    break

            except Exception as e:
                logger.error(f"Failed to fetch app IDs after appid {last_appid}: {e}")
                break

        return all_appids

    def get_last_change_number(self) -> int:
        """Get the last processed PICS change number."""
        try:
            result = (
                self._db.client.table("pics_sync_state")
                .select("last_change_number")
                .eq("id", 1)
                .single()
                .execute()
            )
            return result.data.get("last_change_number", 0) if result.data else 0
        except Exception as e:
            logger.warning(f"Could not get last change number: {e}")
            return 0

    def set_last_change_number(self, change_number: int):
        """Update the last processed PICS change number."""
        try:
            self._db.client.table("pics_sync_state").upsert(
                {
                    "id": 1,
                    "last_change_number": change_number,
                    "updated_at": datetime.utcnow().isoformat(),
                }
            ).execute()
        except Exception as e:
            logger.error(f"Failed to update change number: {e}")
