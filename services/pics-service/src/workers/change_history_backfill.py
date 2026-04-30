"""One-time Supabase -> Tiger/R2 backfill for PICS change-history rows."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Set

from ..config.settings import settings
from ..database.client import SupabaseClient
from ..database.tiger_change_history import TigerPICSChangeHistoryStore

logger = logging.getLogger(__name__)


class ChangeHistoryBackfillWorker:
    """Backfill only source='pics' change snapshots and events."""

    def __init__(self):
        self._db = SupabaseClient.get_instance()
        self._batch_size = max(1, settings.pics_change_history_backfill_batch_size)
        self._limit = settings.pics_change_history_backfill_limit
        self._min_id = max(0, settings.pics_change_history_backfill_min_id)
        self._dry_run = settings.pics_change_history_backfill_dry_run
        self._surfaces = self._parse_surfaces(settings.pics_change_history_backfill_surfaces)
        self._store: Optional[TigerPICSChangeHistoryStore] = None

        if not self._dry_run:
            self._store = TigerPICSChangeHistoryStore.from_settings(settings)

    def run(self) -> Dict[str, Dict[str, int]]:
        logger.info(
            "Starting PICS change-history backfill",
            extra={
                "batch_size": self._batch_size,
                "dry_run": self._dry_run,
                "limit": self._limit,
                "min_id": self._min_id,
                "surfaces": sorted(self._surfaces),
            },
        )

        results: Dict[str, Dict[str, int]] = {}
        if "snapshots" in self._surfaces:
            results["snapshots"] = self._backfill_snapshots()
        if "events" in self._surfaces:
            results["events"] = self._backfill_events()

        logger.info("Completed PICS change-history backfill", extra={"results": results})
        return results

    def _parse_surfaces(self, value: str) -> Set[str]:
        selected = {surface.strip().lower() for surface in value.split(",") if surface.strip()}
        allowed = {"snapshots", "events"}
        unknown = selected - allowed
        if unknown:
            raise ValueError(
                "Unknown PICS_CHANGE_HISTORY_BACKFILL_SURFACES values: "
                f"{', '.join(sorted(unknown))}"
            )
        return selected or allowed

    def _remaining_limit(self, read_count: int) -> int:
        if self._limit is None:
            return self._batch_size
        return max(0, min(self._batch_size, self._limit - read_count))

    def _backfill_snapshots(self) -> Dict[str, int]:
        last_id = self._min_id
        read_count = 0
        written_count = 0

        while True:
            batch_limit = self._remaining_limit(read_count)
            if batch_limit <= 0:
                break

            rows = self._fetch_snapshot_batch(last_id, batch_limit)
            if not rows:
                break

            read_count += len(rows)
            last_id = max(int(row["id"]) for row in rows)

            if not self._dry_run:
                assert self._store is not None
                self._store.insert_snapshots(rows, preserve_ids=True)
                written_count += len(rows)

            logger.info(
                "Backfilled PICS snapshot batch",
                extra={
                    "dry_run": self._dry_run,
                    "last_id": last_id,
                    "read": read_count,
                    "written": written_count,
                },
            )

        return {"read": read_count, "written": written_count}

    def _backfill_events(self) -> Dict[str, int]:
        last_id = self._min_id
        read_count = 0
        written_count = 0

        while True:
            batch_limit = self._remaining_limit(read_count)
            if batch_limit <= 0:
                break

            rows = self._fetch_event_batch(last_id, batch_limit)
            if not rows:
                break

            read_count += len(rows)
            last_id = max(int(row["id"]) for row in rows)

            if not self._dry_run:
                assert self._store is not None
                self._store.insert_change_events(rows, preserve_ids=True)
                written_count += len(rows)

            logger.info(
                "Backfilled PICS event batch",
                extra={
                    "dry_run": self._dry_run,
                    "last_id": last_id,
                    "read": read_count,
                    "written": written_count,
                },
            )

        return {"read": read_count, "written": written_count}

    def _fetch_snapshot_batch(self, last_id: int, limit: int) -> List[Dict[str, Any]]:
        result = (
            self._db.client.table("app_source_snapshots")
            .select(
                "id,appid,source,observed_at,first_seen_at,last_seen_at,content_hash,"
                "previous_snapshot_id,trigger_reason,trigger_cursor,snapshot_data"
            )
            .eq("source", "pics")
            .gt("id", last_id)
            .order("id")
            .limit(limit)
            .execute()
        )
        return result.data or []

    def _fetch_event_batch(self, last_id: int, limit: int) -> List[Dict[str, Any]]:
        result = (
            self._db.client.table("app_change_events")
            .select(
                "id,appid,source,change_type,occurred_at,source_snapshot_id,"
                "related_snapshot_id,media_version_id,news_item_gid,before_value,"
                "after_value,context,trigger_cursor,created_at"
            )
            .eq("source", "pics")
            .gt("id", last_id)
            .order("id")
            .limit(limit)
            .execute()
        )
        return result.data or []
