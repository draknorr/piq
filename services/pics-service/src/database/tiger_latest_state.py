"""Tiger latest-state storage for PICS-derived metadata."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set


def _normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


class TigerPICSLatestStateStore:
    """Postgres writer for PICS latest-state tables in Tiger."""

    def __init__(self, database_url: str):
        self._database_url = database_url

    @classmethod
    def from_settings(cls, settings: Any) -> "TigerPICSLatestStateStore":
        database_url = settings.pics_latest_state_tiger_url or settings.tiger_primary_url
        if not database_url:
            raise ValueError(
                "PICS_LATEST_STATE_TARGET=tiger requires "
                "PICS_LATEST_STATE_TIGER_URL or TIGER_PRIMARY_URL."
            )
        return cls(database_url)

    def _connect(self) -> Any:
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError(
                "PICS_LATEST_STATE_TARGET=tiger requires psycopg. "
                "Install pics-service dependencies."
            ) from error

        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-latest-state",
        )

    def get_existing_appids(self, appids: Sequence[int]) -> List[int]:
        if not appids:
            return []

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT appid FROM legacy.apps WHERE appid = ANY(%s::int[])",
                    (list({int(appid) for appid in appids}),),
                )
                return [int(row[0]) for row in cursor.fetchall()]

    def get_existing_app_names(self, appids: Sequence[int]) -> Dict[int, str]:
        if not appids:
            return {}

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT appid, name FROM legacy.apps WHERE appid = ANY(%s::int[]) AND name IS NOT NULL",
                    (list({int(appid) for appid in appids}),),
                )
                return {int(row[0]): str(row[1]) for row in cursor.fetchall() if row[1]}

    def get_apps_with_storefront_dates(self, appids: Sequence[int]) -> Set[int]:
        if not appids:
            return set()

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT appid
                    FROM legacy.apps
                    WHERE appid = ANY(%s::int[])
                      AND release_date_raw IS NOT NULL
                    """,
                    (list({int(appid) for appid in appids}),),
                )
                return {int(row[0]) for row in cursor.fetchall()}

    def get_apps_with_storefront_sync(self, appids: Sequence[int]) -> Set[int]:
        if not appids:
            return set()

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT appid
                    FROM ops.sync_status
                    WHERE appid = ANY(%s::int[])
                      AND last_storefront_sync IS NOT NULL
                    """,
                    (list({int(appid) for appid in appids}),),
                )
                return {int(row[0]) for row in cursor.fetchall()}

    def upsert_app_records(self, records: List[Dict[str, Any]]) -> Set[int]:
        if not records:
            return set()

        payload = json.dumps(records, default=str)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO legacy.apps (
                      appid, name, type, pics_review_score, pics_review_percentage,
                      controller_support, metacritic_score, metacritic_url, platforms,
                      release_state, homepage_url, app_state, last_content_update,
                      store_asset_mtime, current_build_id, content_descriptors,
                      languages, has_workshop, is_free, release_date, is_released,
                      updated_at
                    )
                    SELECT
                      appid, name, COALESCE(type, 'game'), pics_review_score,
                      pics_review_percentage, controller_support, metacritic_score,
                      metacritic_url, platforms, release_state, homepage_url,
                      app_state, last_content_update, store_asset_mtime,
                      current_build_id, content_descriptors, languages,
                      has_workshop, is_free, release_date, is_released,
                      COALESCE(updated_at, now())
                    FROM jsonb_to_recordset(%s::jsonb) AS app_rows (
                      appid integer,
                      name text,
                      type text,
                      pics_review_score smallint,
                      pics_review_percentage smallint,
                      controller_support text,
                      metacritic_score smallint,
                      metacritic_url text,
                      platforms text,
                      release_state text,
                      homepage_url text,
                      app_state text,
                      last_content_update timestamptz,
                      store_asset_mtime date,
                      current_build_id text,
                      content_descriptors jsonb,
                      languages jsonb,
                      has_workshop boolean,
                      is_free boolean,
                      release_date date,
                      is_released boolean,
                      updated_at timestamptz
                    )
                    ON CONFLICT (appid)
                    DO UPDATE SET
                      name = EXCLUDED.name,
                      type = EXCLUDED.type,
                      pics_review_score = EXCLUDED.pics_review_score,
                      pics_review_percentage = EXCLUDED.pics_review_percentage,
                      controller_support = EXCLUDED.controller_support,
                      metacritic_score = EXCLUDED.metacritic_score,
                      metacritic_url = EXCLUDED.metacritic_url,
                      platforms = EXCLUDED.platforms,
                      release_state = EXCLUDED.release_state,
                      homepage_url = EXCLUDED.homepage_url,
                      app_state = EXCLUDED.app_state,
                      last_content_update = EXCLUDED.last_content_update,
                      store_asset_mtime = EXCLUDED.store_asset_mtime,
                      current_build_id = EXCLUDED.current_build_id,
                      content_descriptors = EXCLUDED.content_descriptors,
                      languages = EXCLUDED.languages,
                      has_workshop = EXCLUDED.has_workshop,
                      is_free = COALESCE(EXCLUDED.is_free, legacy.apps.is_free),
                      release_date = COALESCE(EXCLUDED.release_date, legacy.apps.release_date),
                      is_released = COALESCE(EXCLUDED.is_released, legacy.apps.is_released),
                      updated_at = EXCLUDED.updated_at
                    """,
                    (payload,),
                )

        return {int(record["appid"]) for record in records}

    def upsert_steam_deck(self, appid: int, record: Dict[str, Any]) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO legacy.app_steam_deck (
                      appid, category, test_timestamp, tested_build_id, tests, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb, now())
                    ON CONFLICT (appid)
                    DO UPDATE SET
                      category = EXCLUDED.category,
                      test_timestamp = EXCLUDED.test_timestamp,
                      tested_build_id = EXCLUDED.tested_build_id,
                      tests = EXCLUDED.tests,
                      updated_at = now()
                    """,
                    (
                        appid,
                        record.get("category"),
                        record.get("test_timestamp"),
                        record.get("tested_build_id"),
                        json.dumps(record.get("tests")),
                    ),
                )

    def replace_categories(self, appid: int, category_records: List[Dict[str, Any]], category_ids: List[int]) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                if category_records:
                    cursor.execute(
                        """
                        INSERT INTO legacy.steam_categories (category_id, name)
                        SELECT category_id, name
                        FROM jsonb_to_recordset(%s::jsonb) AS rows (category_id integer, name text)
                        ON CONFLICT (category_id) DO UPDATE SET name = EXCLUDED.name
                        """,
                        (json.dumps(category_records),),
                    )
                cursor.execute("DELETE FROM legacy.app_categories WHERE appid = %s", (appid,))
                if category_ids:
                    cursor.execute(
                        """
                        INSERT INTO legacy.app_categories (appid, category_id)
                        SELECT %s, unnest(%s::int[])
                        ON CONFLICT DO NOTHING
                        """,
                        (appid, category_ids),
                    )

    def replace_genres(self, appid: int, genre_records: List[Dict[str, Any]], genre_ids: List[int], primary_genre_id: Optional[int]) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                if genre_records:
                    cursor.execute(
                        """
                        INSERT INTO legacy.steam_genres (genre_id, name)
                        SELECT genre_id, name
                        FROM jsonb_to_recordset(%s::jsonb) AS rows (genre_id integer, name text)
                        ON CONFLICT (genre_id) DO UPDATE SET name = EXCLUDED.name
                        """,
                        (json.dumps(genre_records),),
                    )
                cursor.execute("DELETE FROM legacy.app_genres WHERE appid = %s", (appid,))
                if genre_ids:
                    cursor.execute(
                        """
                        INSERT INTO legacy.app_genres (appid, genre_id, is_primary)
                        SELECT %s, genre_id, COALESCE(genre_id = %s, false)
                        FROM unnest(%s::int[]) AS genre_id
                        ON CONFLICT (appid, genre_id)
                        DO UPDATE SET is_primary = EXCLUDED.is_primary
                        """,
                        (appid, primary_genre_id, genre_ids),
                    )

    def replace_store_tags(self, appid: int, tag_records: List[Dict[str, Any]], tag_ids: List[int]) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                if tag_records:
                    cursor.execute(
                        """
                        INSERT INTO legacy.steam_tags (tag_id, name, updated_at)
                        SELECT tag_id, name, COALESCE(updated_at, now())
                        FROM jsonb_to_recordset(%s::jsonb) AS rows (
                          tag_id integer,
                          name text,
                          updated_at timestamptz
                        )
                        ON CONFLICT (tag_id)
                        DO UPDATE SET name = EXCLUDED.name, updated_at = EXCLUDED.updated_at
                        """,
                        (json.dumps(tag_records),),
                    )
                cursor.execute("DELETE FROM legacy.app_steam_tags WHERE appid = %s", (appid,))
                if tag_ids:
                    cursor.execute(
                        """
                        INSERT INTO legacy.app_steam_tags (appid, tag_id, rank)
                        SELECT %s, tag_id, (rank - 1)::integer
                        FROM unnest(%s::int[]) WITH ORDINALITY AS tags(tag_id, rank)
                        ON CONFLICT (appid, tag_id)
                        DO UPDATE SET rank = EXCLUDED.rank
                        """,
                        (appid, tag_ids),
                    )

    def upsert_franchise_link(self, appid: int, franchise_name: str) -> None:
        normalized_name = _normalize_name(franchise_name)
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO legacy.franchises (name, normalized_name, updated_at)
                    VALUES (%s, %s, now())
                    ON CONFLICT (normalized_name)
                    DO UPDATE SET name = EXCLUDED.name, updated_at = now()
                    RETURNING id
                    """,
                    (franchise_name, normalized_name),
                )
                franchise_id = cursor.fetchone()[0]
                cursor.execute(
                    """
                    INSERT INTO legacy.app_franchises (appid, franchise_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (appid, franchise_id),
                )

    def sync_dlc_relationships(self, parent_appid: int, dlc_appids: List[int]) -> None:
        if not dlc_appids:
            return

        placeholder_rows = [
            {
                "appid": appid,
                "name": f"Steam App {appid}",
                "type": "dlc",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
            for appid in dlc_appids
        ]
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO legacy.apps (appid, name, type, updated_at)
                    SELECT appid, name, type, updated_at
                    FROM jsonb_to_recordset(%s::jsonb) AS rows (
                      appid integer,
                      name text,
                      type text,
                      updated_at timestamptz
                    )
                    ON CONFLICT (appid) DO NOTHING
                    """,
                    (json.dumps(placeholder_rows),),
                )
                cursor.execute(
                    """
                    INSERT INTO legacy.app_dlc (parent_appid, dlc_appid, source)
                    SELECT %s, unnest(%s::int[]), 'pics'
                    ON CONFLICT (parent_appid, dlc_appid) DO UPDATE SET source = EXCLUDED.source
                    """,
                    (parent_appid, dlc_appids),
                )

    def update_sync_status(self, appids: List[int], trigger_cursor: Optional[str]) -> None:
        if not appids:
            return

        pics_change_number = int(trigger_cursor) if trigger_cursor else None
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO ops.sync_status (
                      appid, last_pics_sync, pics_change_number, updated_at
                    )
                    SELECT appid, now(), %s, now()
                    FROM unnest(%s::int[]) AS appid
                    ON CONFLICT (appid)
                    DO UPDATE SET
                      last_pics_sync = EXCLUDED.last_pics_sync,
                      pics_change_number = COALESCE(EXCLUDED.pics_change_number, ops.sync_status.pics_change_number),
                      updated_at = now()
                    """,
                    (pics_change_number, appids),
                )

    def get_first_pass_candidates(self, limit: int) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      s.appid,
                      s.last_pics_sync,
                      s.last_storefront_sync,
                      s.storefront_accessible,
                      a.release_date,
                      a.is_released
                    FROM ops.sync_status s
                    JOIN legacy.apps a ON a.appid = s.appid
                    WHERE s.last_pics_sync IS NULL
                      AND s.last_storefront_sync IS NOT NULL
                    ORDER BY s.last_storefront_sync DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                return [
                    {
                        "appid": row[0],
                        "last_pics_sync": row[1].isoformat() if row[1] else None,
                        "last_storefront_sync": row[2].isoformat() if row[2] else None,
                        "storefront_accessible": row[3],
                        "apps": {
                            "release_date": row[4].isoformat() if row[4] else None,
                            "is_released": row[5],
                        },
                    }
                    for row in cursor.fetchall()
                ]

    def get_unsynced_app_ids_after(self, last_appid: int, limit: int) -> List[int]:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT appid
                    FROM ops.sync_status
                    WHERE last_pics_sync IS NULL
                      AND appid > %s
                    ORDER BY appid
                    LIMIT %s
                    """,
                    (last_appid, limit),
                )
                return [int(row[0]) for row in cursor.fetchall()]

    def get_all_app_ids_after(self, last_appid: int, limit: int) -> List[int]:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT appid
                    FROM legacy.apps
                    WHERE appid > %s
                    ORDER BY appid
                    LIMIT %s
                    """,
                    (last_appid, limit),
                )
                return [int(row[0]) for row in cursor.fetchall()]

    def get_last_change_number(self) -> int:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT last_change_number FROM ops.pics_sync_state WHERE id = 1"
                )
                row = cursor.fetchone()
                return int(row[0]) if row else 0

    def set_last_change_number(self, change_number: int) -> None:
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO ops.pics_sync_state (id, last_change_number, updated_at)
                    VALUES (1, %s, now())
                    ON CONFLICT (id)
                    DO UPDATE SET
                      last_change_number = EXCLUDED.last_change_number,
                      updated_at = now()
                    """,
                    (change_number,),
                )
