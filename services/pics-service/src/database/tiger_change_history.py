"""Tiger/R2 storage for PICS change-history rows."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional, Sequence

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ArchivePointer:
    bucket: str
    byte_size: int
    content_hash: str
    content_type: str
    key: str


@dataclass(frozen=True)
class ArchiveConfig:
    access_key_id: Optional[str]
    bucket: str
    endpoint: Optional[str]
    force_path_style: bool
    prefix: str
    region: str
    secret_access_key: Optional[str]


def _bool_env(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _json_body(payload: Any) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode(
        "utf-8"
    )


def _hash_body(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _sanitize_key_part(part: str) -> str:
    sanitized = re.sub(r"[^A-Za-z0-9._=-]+", "-", part.strip())
    return sanitized.strip("-")[:120]


def _today_key_prefix(now: Optional[datetime] = None) -> str:
    current = now or datetime.now(timezone.utc)
    return f"{current.year:04d}/{current.month:02d}/{current.day:02d}"


def _build_archive_key(
    *,
    content_hash: str,
    key_parts: Sequence[str],
    kind: str,
    prefix: str,
) -> str:
    parts = [
        prefix,
        kind,
        _today_key_prefix(),
        *[_sanitize_key_part(part) for part in key_parts],
        f"{content_hash}.json",
    ]
    return "/".join(part for part in parts if part)


def _json_or_none(value: Any) -> Any:
    if value is None:
        return None
    return value


def summarize_pics_snapshot(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    """Small searchable summary; the full normalized snapshot lives in R2."""

    def count(key: str) -> int:
        value = snapshot.get(key)
        return len(value) if isinstance(value, list) else 0

    return {
        "appState": snapshot.get("app_state"),
        "currentBuildId": snapshot.get("current_build_id"),
        "lastContentUpdate": snapshot.get("last_content_update"),
        "name": snapshot.get("name"),
        "releaseState": snapshot.get("release_state"),
        "reviewPercentage": snapshot.get("review_percentage"),
        "reviewScore": snapshot.get("review_score"),
        "steamDeckCategory": snapshot.get("steam_deck_category"),
        "type": snapshot.get("type"),
        "counts": {
            "categories": count("categories"),
            "developerNames": count("developer_names"),
            "dlcAppids": count("dlc_appids"),
            "franchiseNames": count("franchise_names"),
            "genres": count("genres"),
            "platforms": count("platforms"),
            "publisherNames": count("publisher_names"),
            "storeTags": count("store_tags"),
        },
    }


class S3ArchiveStore:
    """Minimal S3-compatible JSON archive store for Cloudflare R2."""

    def __init__(self, config: ArchiveConfig):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as error:
            raise RuntimeError(
                "PICS_CHANGE_HISTORY_TARGET=tiger requires boto3. "
                "Install pics-service dependencies."
            ) from error

        addressing_style = "path" if config.force_path_style else "auto"
        max_pool_connections = max(
            10,
            int(
                os.environ.get(
                    "CHANGE_INTEL_ARCHIVE_MAX_POOL_CONNECTIONS",
                    os.environ.get("CHANGE_INTEL_ARCHIVE_WORKERS", "16"),
                )
            ),
        )
        self._bucket = config.bucket
        self._prefix = config.prefix
        self._client = boto3.client(
            "s3",
            aws_access_key_id=config.access_key_id,
            aws_secret_access_key=config.secret_access_key,
            config=Config(
                max_pool_connections=max_pool_connections,
                s3={"addressing_style": addressing_style},
            ),
            endpoint_url=config.endpoint,
            region_name=config.region,
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "S3ArchiveStore":
        target = env.get("CHANGE_INTEL_ARCHIVE_TARGET", "disabled").strip().lower()
        if target != "object_storage":
            raise ValueError(
                "PICS_CHANGE_HISTORY_TARGET=tiger requires "
                "CHANGE_INTEL_ARCHIVE_TARGET=object_storage."
            )

        bucket = env.get("CHANGE_INTEL_ARCHIVE_BUCKET") or env.get("CHANGE_INTEL_ARCHIVE_S3_BUCKET")
        if not bucket:
            raise ValueError(
                "PICS_CHANGE_HISTORY_TARGET=tiger requires CHANGE_INTEL_ARCHIVE_BUCKET."
            )

        return cls(
            ArchiveConfig(
                access_key_id=env.get("CHANGE_INTEL_ARCHIVE_ACCESS_KEY_ID"),
                bucket=bucket,
                endpoint=env.get("CHANGE_INTEL_ARCHIVE_ENDPOINT"),
                force_path_style=_bool_env(env.get("CHANGE_INTEL_ARCHIVE_FORCE_PATH_STYLE"), True),
                prefix=env.get("CHANGE_INTEL_ARCHIVE_PREFIX", "change-intel"),
                region=env.get("CHANGE_INTEL_ARCHIVE_REGION", "us-east-1"),
                secret_access_key=env.get("CHANGE_INTEL_ARCHIVE_SECRET_ACCESS_KEY"),
            )
        )

    def write_json(
        self,
        *,
        content_hash: Optional[str],
        key_parts: Sequence[str],
        kind: str,
        payload: Any,
    ) -> ArchivePointer:
        body = _json_body(payload)
        archive_content_hash = content_hash or _hash_body(body)
        key = _build_archive_key(
            content_hash=archive_content_hash,
            key_parts=key_parts,
            kind=kind,
            prefix=self._prefix,
        )

        self._client.put_object(
            Body=body,
            Bucket=self._bucket,
            ContentType="application/json",
            Key=key,
        )

        return ArchivePointer(
            bucket=self._bucket,
            byte_size=len(body),
            content_hash=archive_content_hash,
            content_type="application/json",
            key=key,
        )

    def read_json(self, *, bucket: str, key: str) -> Dict[str, Any]:
        response = self._client.get_object(Bucket=bucket, Key=key)
        body = response["Body"].read()
        return json.loads(body.decode("utf-8"))


class TigerPICSChangeHistoryStore:
    """Postgres writer for PICS history tables in Tiger."""

    def __init__(self, database_url: str, archive_store: S3ArchiveStore):
        self._database_url = database_url
        self._archive_store = archive_store
        self._archive_workers = max(
            1,
            int(os.environ.get("CHANGE_INTEL_ARCHIVE_WORKERS", "16")),
        )

    @classmethod
    def from_settings(cls, settings: Any) -> "TigerPICSChangeHistoryStore":
        database_url = settings.pics_change_history_tiger_url or settings.tiger_primary_url
        if not database_url:
            raise ValueError(
                "PICS_CHANGE_HISTORY_TARGET=tiger requires "
                "PICS_CHANGE_HISTORY_TIGER_URL or TIGER_PRIMARY_URL."
            )
        return cls(database_url, S3ArchiveStore.from_env())

    def _connect(self) -> Any:
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError(
                "PICS_CHANGE_HISTORY_TARGET=tiger requires psycopg. "
                "Install pics-service dependencies."
            ) from error

        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-change-history",
        )

    def get_latest_snapshots(self, appids: List[int]) -> Dict[int, Dict[str, Any]]:
        if not appids:
            return {}

        from psycopg.rows import dict_row

        latest_by_appid: Dict[int, Dict[str, Any]] = {}
        unique_appids = sorted({int(appid) for appid in appids})

        with self._connect() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    """
                    SELECT
                      id::text,
                      appid,
                      content_hash,
                      first_seen_at::text,
                      archive_bucket,
                      archive_key
                    FROM docs.app_source_snapshots
                    WHERE source = 'pics'
                      AND appid = ANY(%s::int[])
                    ORDER BY appid ASC, first_seen_at DESC, id DESC
                    """,
                    (unique_appids,),
                )
                rows = cursor.fetchall()

        for row in rows:
            appid = int(row["appid"])
            if appid in latest_by_appid:
                continue

            archive_bucket = row.get("archive_bucket")
            archive_key = row.get("archive_key")
            if not archive_bucket or not archive_key:
                raise ValueError(
                    f"Tiger PICS snapshot {row['id']} for app {appid} does not have "
                    "an R2 archive pointer."
                )

            latest_by_appid[appid] = {
                "appid": appid,
                "content_hash": row["content_hash"],
                "first_seen_at": row["first_seen_at"],
                "id": row["id"],
                "snapshot_data": self._archive_store.read_json(
                    bucket=str(archive_bucket),
                    key=str(archive_key),
                ),
            }

        return latest_by_appid

    def update_last_seen_snapshots(self, snapshot_ids: List[int], observed_at: str) -> None:
        if not snapshot_ids:
            return

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    UPDATE docs.app_source_snapshots
                    SET last_seen_at = %s::timestamptz,
                        observed_at = %s::timestamptz
                    WHERE id = ANY(%s::bigint[])
                    """,
                    (observed_at, observed_at, [int(snapshot_id) for snapshot_id in snapshot_ids]),
                )

    def insert_snapshots(
        self,
        snapshot_rows: List[Dict[str, Any]],
        *,
        preserve_ids: bool = False,
    ) -> List[Dict[str, Any]]:
        if not snapshot_rows:
            return []

        from psycopg.rows import dict_row

        def archive_row(row: Dict[str, Any]) -> Dict[str, Any]:
            snapshot_data = row["snapshot_data"]
            content_hash = row["content_hash"]
            appid = int(row["appid"])
            pointer = self._archive_store.write_json(
                content_hash=content_hash,
                key_parts=[str(appid), "pics", str(content_hash)],
                kind="app-source-snapshot",
                payload=snapshot_data,
            )
            payload: Dict[str, Any] = {
                "appid": appid,
                "archive_bucket": pointer.bucket,
                "archive_byte_size": pointer.byte_size,
                "archive_content_hash": pointer.content_hash,
                "archive_content_type": pointer.content_type,
                "archive_key": pointer.key,
                "archived_at": datetime.now(timezone.utc).isoformat(),
                "content_hash": content_hash,
                "first_seen_at": row.get("first_seen_at") or row["observed_at"],
                "last_seen_at": row.get("last_seen_at") or row["observed_at"],
                "observed_at": row["observed_at"],
                "previous_snapshot_id": row.get("previous_snapshot_id"),
                "snapshot_summary": summarize_pics_snapshot(snapshot_data),
                "trigger_cursor": row.get("trigger_cursor"),
                "trigger_reason": row["trigger_reason"],
            }
            if preserve_ids:
                payload["id"] = row.get("id")
            return payload

        if self._archive_workers == 1 or len(snapshot_rows) == 1:
            payload = [archive_row(row) for row in snapshot_rows]
        else:
            with ThreadPoolExecutor(max_workers=self._archive_workers) as executor:
                payload = list(executor.map(archive_row, snapshot_rows))

        insert_id_sql = "id, " if preserve_ids else ""
        select_id_sql = "id, " if preserve_ids else ""
        record_id_sql = "id bigint," if preserve_ids else ""
        conflict_sql = (
            """
            ON CONFLICT (id) DO UPDATE SET
              observed_at = EXCLUDED.observed_at,
              first_seen_at = EXCLUDED.first_seen_at,
              last_seen_at = EXCLUDED.last_seen_at,
              content_hash = EXCLUDED.content_hash,
              previous_snapshot_id = EXCLUDED.previous_snapshot_id,
              trigger_reason = EXCLUDED.trigger_reason,
              trigger_cursor = EXCLUDED.trigger_cursor,
              snapshot_summary = EXCLUDED.snapshot_summary,
              archive_bucket = EXCLUDED.archive_bucket,
              archive_key = EXCLUDED.archive_key,
              archive_content_hash = EXCLUDED.archive_content_hash,
              archive_byte_size = EXCLUDED.archive_byte_size,
              archive_content_type = EXCLUDED.archive_content_type,
              archived_at = EXCLUDED.archived_at
            """
            if preserve_ids
            else ""
        )

        with self._connect() as connection:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO docs.app_source_snapshots (
                      {insert_id_sql}appid, source, observed_at, first_seen_at, last_seen_at,
                      content_hash, previous_snapshot_id, trigger_reason, trigger_cursor,
                      snapshot_summary, archive_bucket, archive_key, archive_content_hash,
                      archive_byte_size, archive_content_type, archived_at
                    )
                    SELECT
                      {select_id_sql}appid, 'pics', observed_at, first_seen_at, last_seen_at,
                      content_hash, previous_snapshot_id, trigger_reason, trigger_cursor,
                      COALESCE(snapshot_summary, '{{}}'::jsonb), archive_bucket, archive_key,
                      archive_content_hash, archive_byte_size, archive_content_type, archived_at
                    FROM jsonb_to_recordset(%s::jsonb) AS snapshot_rows (
                      {record_id_sql}
                      appid integer,
                      observed_at timestamptz,
                      first_seen_at timestamptz,
                      last_seen_at timestamptz,
                      content_hash text,
                      previous_snapshot_id bigint,
                      trigger_reason text,
                      trigger_cursor text,
                      snapshot_summary jsonb,
                      archive_bucket text,
                      archive_key text,
                      archive_content_hash text,
                      archive_byte_size bigint,
                      archive_content_type text,
                      archived_at timestamptz
                    )
                    {conflict_sql}
                    RETURNING id::text, appid
                    """,
                    (json.dumps(payload),),
                )
                return [
                    {"appid": row["appid"], "id": row["id"]}
                    for row in cursor.fetchall()
                ]

    def insert_change_events(
        self,
        event_rows: List[Dict[str, Any]],
        *,
        preserve_ids: bool = False,
    ) -> None:
        if not event_rows:
            return

        payload = []
        for row in event_rows:
            payload.append(
                {
                    **({"id": row.get("id")} if preserve_ids else {}),
                    "after_value": _json_or_none(row.get("after_value")),
                    "appid": row["appid"],
                    "before_value": _json_or_none(row.get("before_value")),
                    "change_type": row["change_type"],
                    "context": row.get("context") or {},
                    "created_at": row.get("created_at") or datetime.now(timezone.utc).isoformat(),
                    "media_version_id": row.get("media_version_id"),
                    "news_item_gid": row.get("news_item_gid"),
                    "occurred_at": row["occurred_at"],
                    "related_snapshot_id": row.get("related_snapshot_id"),
                    "source": "pics",
                    "source_snapshot_id": row.get("source_snapshot_id"),
                    "trigger_cursor": row.get("trigger_cursor"),
                }
            )

        id_column_sql = "id, " if preserve_ids else ""
        id_select_sql = "id, " if preserve_ids else ""
        id_record_sql = "id bigint," if preserve_ids else ""
        conflict_sql = "ON CONFLICT (occurred_at, id) DO NOTHING" if preserve_ids else ""

        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    f"""
                    INSERT INTO events.app_change_events (
                      {id_column_sql}appid, source, change_type, occurred_at,
                      source_snapshot_id, related_snapshot_id, media_version_id,
                      news_item_gid, before_value, after_value, context, trigger_cursor,
                      created_at
                    )
                    SELECT
                      {id_select_sql}appid, source, change_type, occurred_at,
                      source_snapshot_id, related_snapshot_id, media_version_id,
                      news_item_gid, before_value, after_value, COALESCE(context, '{{}}'::jsonb),
                      trigger_cursor, created_at
                    FROM jsonb_to_recordset(%s::jsonb) AS event_rows (
                      {id_record_sql}
                      appid integer,
                      source text,
                      change_type text,
                      occurred_at timestamptz,
                      source_snapshot_id bigint,
                      related_snapshot_id bigint,
                      media_version_id bigint,
                      news_item_gid text,
                      before_value jsonb,
                      after_value jsonb,
                      context jsonb,
                      trigger_cursor text,
                      created_at timestamptz
                    )
                    {conflict_sql}
                    """,
                    (json.dumps(payload),),
                )
