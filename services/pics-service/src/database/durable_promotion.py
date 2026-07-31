"""Atomic Tiger promotion for validated durable PICS product payloads."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Mapping, Optional

from ..extractors.common import Association, ExtractedPICSData
from ..extractors.taxonomy import CATEGORY_NAMES, GENRE_NAMES
from .change_intelligence import diff_pics_snapshots
from .durable_payload import ValidatedPICSPayload, serialize_payload_evidence
from .durable_work import (
    PICSLatestSnapshot,
    PICSWorkClaim,
    PICSWorkStateError,
    TigerPICSDurableWorkStore,
)
from .tiger_change_history import ArchivePointer, summarize_pics_snapshot
from .tiger_latest_state import resolve_tiger_franchise_id


@dataclass(frozen=True)
class PICSPromotionResult:
    """Committed latest-state and work acknowledgement."""

    appid: int
    snapshot_id: int
    snapshot_changed: bool
    event_count: int
    completed_through_change_number: int
    next_work_state: str


class TigerPICSDurablePromoter:
    """Promote one app and acknowledge its lease in a single Tiger transaction."""

    def __init__(
        self,
        database_url: str,
        work_store: TigerPICSDurableWorkStore,
        *,
        connection_factory: Optional[Callable[[], Any]] = None,
    ):
        if not database_url and connection_factory is None:
            raise ValueError("A Tiger database URL is required for durable PICS promotion")
        self._database_url = database_url
        self._work_store = work_store
        self._connection_factory = connection_factory

    @classmethod
    def from_settings(
        cls,
        settings: Any,
        work_store: TigerPICSDurableWorkStore,
    ) -> "TigerPICSDurablePromoter":
        database_url = settings.pics_latest_state_tiger_url or settings.tiger_primary_url
        if not database_url:
            raise ValueError(
                "Durable PICS promotion requires PICS_LATEST_STATE_TIGER_URL or TIGER_PRIMARY_URL"
            )
        return cls(database_url, work_store)

    def _connect(self) -> Any:
        if self._connection_factory is not None:
            return self._connection_factory()

        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError(
                "Durable PICS promotion requires psycopg. Install pics-service dependencies."
            ) from error

        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-durable-promotion",
        )

    def promote(
        self,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
        payload: ValidatedPICSPayload,
        previous_pointer: Optional[PICSLatestSnapshot],
        previous_snapshot: Optional[Mapping[str, Any]],
        archive: Optional[ArchivePointer],
    ) -> PICSPromotionResult:
        """Commit snapshot, events, latest state, readiness, and acknowledgement."""

        if claim.work_mode != "durable" or claim.stream_key != "primary":
            raise ValueError("Primary promotion requires durable work on the primary stream")
        if payload.appid != claim.appid:
            raise ValueError("Validated payload appid does not match the work claim")
        snapshot_changed = (
            previous_pointer is None
            or previous_pointer.content_hash != payload.normalized_snapshot_sha256
        )
        if snapshot_changed and archive is None:
            raise ValueError("A changed PICS snapshot requires an immutable R2 archive pointer")

        observed_at = datetime.now(timezone.utc)
        diff_events = (
            diff_pics_snapshots(
                dict(previous_snapshot),
                payload.normalized_snapshot,
            )
            if previous_pointer is not None and previous_snapshot is not None
            else []
        )

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._work_store.configure_transaction(cursor)
                    self._work_store.lock_claim_for_promotion(
                        cursor,
                        claim=claim,
                        worker_id=worker_id,
                    )
                    self._assert_latest_snapshot(
                        cursor,
                        appid=claim.appid,
                        expected=previous_pointer,
                    )
                    snapshot_id = self._record_snapshot(
                        cursor,
                        claim=claim,
                        payload=payload,
                        previous_pointer=previous_pointer,
                        archive=archive,
                        observed_at=observed_at,
                    )
                    self._apply_app_fields(cursor, payload.extracted)
                    self._apply_relationships(cursor, payload.extracted)
                    self._record_field_evidence(
                        cursor,
                        app=payload.extracted,
                        source_change_number=payload.source_change_number,
                        source_at=observed_at,
                    )
                    self._update_sync_status(
                        cursor,
                        appid=claim.appid,
                        change_number=payload.source_change_number,
                    )
                    event_count = self._insert_events(
                        cursor,
                        claim=claim,
                        snapshot_id=snapshot_id,
                        source_change_number=payload.source_change_number,
                        previous_pointer=previous_pointer,
                        archive=archive,
                        events=diff_events,
                        observed_at=observed_at,
                    )
                    provenance = {
                        "workId": claim.id,
                        "streamKey": claim.stream_key,
                        "completedThroughChangeNumber": (claim.claimed_through_change_number),
                        "sourceChangeNumber": payload.source_change_number,
                        "snapshotId": snapshot_id,
                        "snapshotContentHash": payload.normalized_snapshot_sha256,
                        "rawPayloadSha256": payload.raw_payload_sha256,
                        "snapshotChanged": snapshot_changed,
                        "sourceEvidence": serialize_payload_evidence(
                            payload.extracted.source_evidence
                        ),
                    }
                    if claim.needs_token:
                        provenance["tokenRequestEvidence"] = payload.raw_payload.get(
                            "_token_request",
                            {"needsToken": True, "status": "unknown"},
                        )
                        token_archive = payload.raw_payload.get("_token_evidence_archive")
                        if isinstance(token_archive, dict):
                            provenance["tokenEvidenceArchive"] = token_archive
                    if claim.reconciliation_run_id is not None:
                        provenance["reconciliationRunId"] = str(claim.reconciliation_run_id)
                    if archive is not None:
                        provenance["archive"] = {
                            "bucket": archive.bucket,
                            "key": archive.key,
                            "contentHash": archive.content_hash,
                            "byteSize": archive.byte_size,
                            "contentType": archive.content_type,
                        }
                    self._work_store.upsert_ready_state(
                        cursor,
                        appid=claim.appid,
                        provenance=provenance,
                        source_at=observed_at,
                    )
                    next_state = self._work_store.complete_locked_claim(
                        cursor,
                        claim=claim,
                        snapshot_id=snapshot_id,
                        source_change_number=payload.source_change_number,
                    )

        return PICSPromotionResult(
            appid=claim.appid,
            snapshot_id=snapshot_id,
            snapshot_changed=snapshot_changed,
            event_count=event_count,
            completed_through_change_number=claim.claimed_through_change_number,
            next_work_state=next_state,
        )

    @staticmethod
    def _assert_latest_snapshot(
        cursor: Any,
        *,
        appid: int,
        expected: Optional[PICSLatestSnapshot],
    ) -> None:
        cursor.execute(
            """
            SELECT id, content_hash
            FROM docs.app_source_snapshots
            WHERE source = 'pics'
              AND appid = %s
            ORDER BY first_seen_at DESC, id DESC
            LIMIT 1
            FOR UPDATE
            """,
            (appid,),
        )
        row = cursor.fetchone()
        if expected is None and row is None:
            return
        if expected is None or row is None:
            raise PICSWorkStateError(
                f"Latest PICS snapshot changed before promotion for app {appid}"
            )
        if int(row[0]) != expected.id or str(row[1]) != expected.content_hash:
            raise PICSWorkStateError(
                f"Latest PICS snapshot changed before promotion for app {appid}"
            )

    @staticmethod
    def _record_snapshot(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        payload: ValidatedPICSPayload,
        previous_pointer: Optional[PICSLatestSnapshot],
        archive: Optional[ArchivePointer],
        observed_at: datetime,
    ) -> int:
        if (
            previous_pointer is not None
            and previous_pointer.content_hash == payload.normalized_snapshot_sha256
        ):
            cursor.execute(
                """
                UPDATE docs.app_source_snapshots
                SET observed_at = %s,
                    last_seen_at = %s
                WHERE id = %s
                RETURNING id
                """,
                (observed_at, observed_at, previous_pointer.id),
            )
            row = cursor.fetchone()
            if row is None:
                raise PICSWorkStateError(f"Latest PICS snapshot {previous_pointer.id} disappeared")
            return int(row[0])

        if archive is None:
            raise ValueError("Changed snapshot is missing its archive pointer")
        cursor.execute(
            """
            INSERT INTO docs.app_source_snapshots (
              appid,
              source,
              observed_at,
              first_seen_at,
              last_seen_at,
              content_hash,
              previous_snapshot_id,
              trigger_reason,
              trigger_cursor,
              snapshot_summary,
              archive_bucket,
              archive_key,
              archive_content_hash,
              archive_byte_size,
              archive_content_type,
              archived_at
            )
            VALUES (
              %s,
              'pics',
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s::jsonb,
              %s,
              %s,
              %s,
              %s,
              %s,
              %s
            )
            RETURNING id
            """,
            (
                claim.appid,
                observed_at,
                observed_at,
                observed_at,
                payload.normalized_snapshot_sha256,
                previous_pointer.id if previous_pointer else None,
                (
                    "full_state_reconciliation"
                    if claim.reconciliation_run_id is not None
                    else "durable_change_monitor"
                ),
                str(payload.source_change_number),
                json.dumps(
                    summarize_pics_snapshot(payload.normalized_snapshot),
                    sort_keys=True,
                ),
                archive.bucket,
                archive.key,
                archive.content_hash,
                archive.byte_size,
                archive.content_type,
                observed_at,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise RuntimeError(f"Failed to insert PICS snapshot for app {claim.appid}")
        return int(row[0])

    @staticmethod
    def _apply_app_fields(cursor: Any, app: ExtractedPICSData) -> None:
        evidence = app.source_evidence
        if evidence is None or not evidence.source_complete:
            raise ValueError("Durable app promotion requires source-complete evidence")

        cursor.execute(
            """
            INSERT INTO legacy.apps (appid, name, type, updated_at)
            VALUES (%s, %s, %s, clock_timestamp())
            ON CONFLICT (appid) DO NOTHING
            """,
            (
                app.appid,
                app.name or f"Steam App {app.appid}",
                app.type or "game",
            ),
        )
        record = {
            "present_fields": sorted(evidence.present_fields),
            "name": app.name,
            "type": app.type,
            "pics_review_score": app.review_score,
            "pics_review_percentage": app.review_percentage,
            "controller_support": app.controller_support,
            "metacritic_score": app.metacritic_score,
            "metacritic_url": app.metacritic_url,
            "platforms": ",".join(app.platforms) if app.platforms else "",
            "release_state": app.release_state,
            "homepage_url": app.homepage_url,
            "app_state": app.app_state,
            "last_content_update": (
                app.last_update_timestamp.isoformat() if app.last_update_timestamp else None
            ),
            "store_asset_mtime": (
                app.store_asset_mtime.date().isoformat() if app.store_asset_mtime else None
            ),
            "current_build_id": app.current_build_id,
            "content_descriptors": app.content_descriptors,
            "languages": app.languages,
            "has_workshop": app.has_workshop,
            "is_free": app.is_free,
            "release_date": (
                app.steam_release_date.date().isoformat() if app.steam_release_date else None
            ),
            "is_released": app.release_state == "released",
        }
        cursor.execute(
            """
            WITH input AS (
              SELECT *
              FROM jsonb_to_record(%s::jsonb) AS input_values (
                present_fields jsonb,
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
                is_released boolean
              )
            )
            UPDATE legacy.apps app
            SET name = CASE
                  WHEN input.present_fields ? 'name'
                    THEN coalesce(input.name, app.name)
                  ELSE app.name
                END,
                type = CASE
                  WHEN input.present_fields ? 'type'
                    THEN coalesce(input.type, app.type)
                  ELSE app.type
                END,
                pics_review_score = CASE
                  WHEN input.present_fields ? 'review_score'
                    THEN input.pics_review_score
                  ELSE app.pics_review_score
                END,
                pics_review_percentage = CASE
                  WHEN input.present_fields ? 'review_percentage'
                    THEN input.pics_review_percentage
                  ELSE app.pics_review_percentage
                END,
                controller_support = CASE
                  WHEN input.present_fields ? 'controller_support'
                    THEN input.controller_support
                  ELSE app.controller_support
                END,
                metacritic_score = CASE
                  WHEN input.present_fields ? 'metacritic_score'
                    THEN input.metacritic_score
                  ELSE app.metacritic_score
                END,
                metacritic_url = CASE
                  WHEN input.present_fields ? 'metacritic_url'
                    THEN input.metacritic_url
                  ELSE app.metacritic_url
                END,
                platforms = CASE
                  WHEN input.present_fields ? 'platforms'
                    THEN input.platforms
                  ELSE app.platforms
                END,
                release_state = CASE
                  WHEN input.present_fields ? 'release_state'
                    THEN input.release_state
                  ELSE app.release_state
                END,
                homepage_url = CASE
                  WHEN input.present_fields ? 'homepage_url'
                    THEN input.homepage_url
                  ELSE app.homepage_url
                END,
                app_state = CASE
                  WHEN input.present_fields ? 'app_state'
                    THEN input.app_state
                  ELSE app.app_state
                END,
                last_content_update = CASE
                  WHEN input.present_fields ? 'last_content_update'
                    THEN input.last_content_update
                  ELSE app.last_content_update
                END,
                store_asset_mtime = CASE
                  WHEN input.present_fields ? 'store_asset_mtime'
                    THEN input.store_asset_mtime
                  ELSE app.store_asset_mtime
                END,
                current_build_id = CASE
                  WHEN input.present_fields ? 'current_build_id'
                    THEN input.current_build_id
                  ELSE app.current_build_id
                END,
                content_descriptors = CASE
                  WHEN input.present_fields ? 'content_descriptors'
                    THEN input.content_descriptors
                  ELSE app.content_descriptors
                END,
                languages = CASE
                  WHEN input.present_fields ? 'languages'
                    THEN input.languages
                  ELSE app.languages
                END,
                has_workshop = CASE
                  WHEN input.present_fields ? 'has_workshop'
                    THEN input.has_workshop
                  ELSE app.has_workshop
                END,
                is_free = CASE
                  WHEN input.present_fields ? 'is_free'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM ops.sync_status sync
                      WHERE sync.appid = app.appid
                        AND sync.last_storefront_sync IS NOT NULL
                    )
                    THEN input.is_free
                  ELSE app.is_free
                END,
                release_date = CASE
                  WHEN input.present_fields ? 'steam_release_date'
                    AND app.release_date_raw IS NULL
                    THEN input.release_date
                  ELSE app.release_date
                END,
                is_released = CASE
                  WHEN input.present_fields ? 'is_released'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM ops.sync_status sync
                      WHERE sync.appid = app.appid
                        AND sync.last_storefront_sync IS NOT NULL
                    )
                    THEN input.is_released
                  ELSE app.is_released
                END,
                updated_at = clock_timestamp()
            FROM input
            WHERE app.appid = %s
            """,
            (json.dumps(record, sort_keys=True, default=str), app.appid),
        )
        if cursor.rowcount != 1:
            raise RuntimeError(f"Failed to update PICS latest state for app {app.appid}")

        if evidence.field_is_present("steam_deck") and app.steam_deck is not None:
            category_map = {
                0: "unknown",
                1: "unsupported",
                2: "playable",
                3: "verified",
            }
            cursor.execute(
                """
                INSERT INTO legacy.app_steam_deck (
                  appid,
                  category,
                  test_timestamp,
                  tested_build_id,
                  tests,
                  updated_at
                )
                VALUES (%s, %s, %s, %s, %s::jsonb, clock_timestamp())
                ON CONFLICT (appid)
                DO UPDATE SET
                  category = EXCLUDED.category,
                  test_timestamp = EXCLUDED.test_timestamp,
                  tested_build_id = EXCLUDED.tested_build_id,
                  tests = EXCLUDED.tests,
                  updated_at = clock_timestamp()
                """,
                (
                    app.appid,
                    category_map.get(app.steam_deck.category, "unknown"),
                    (
                        datetime.fromtimestamp(
                            app.steam_deck.test_timestamp,
                            tz=timezone.utc,
                        )
                        if app.steam_deck.test_timestamp
                        else None
                    ),
                    app.steam_deck.tested_build_id,
                    (
                        json.dumps(app.steam_deck.tests, sort_keys=True, default=str)
                        if app.steam_deck.tests is not None
                        else None
                    ),
                ),
            )

    @classmethod
    def _apply_relationships(cls, cursor: Any, app: ExtractedPICSData) -> None:
        evidence = app.source_evidence
        if evidence is None:
            raise ValueError("Relationship promotion requires source evidence")

        if evidence.family_is_complete("categories"):
            category_ids = sorted(
                {int(category_id) for category_id, enabled in app.categories.items() if enabled}
            )
            if category_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.steam_categories (category_id, name)
                    SELECT category_id, name
                    FROM jsonb_to_recordset(%s::jsonb)
                      AS rows(category_id integer, name text)
                    ON CONFLICT (category_id) DO UPDATE SET name = EXCLUDED.name
                    """,
                    (
                        json.dumps(
                            [
                                {
                                    "category_id": category_id,
                                    "name": CATEGORY_NAMES.get(
                                        category_id,
                                        f"Category {category_id}",
                                    ),
                                }
                                for category_id in category_ids
                            ]
                        ),
                    ),
                )
            cursor.execute("DELETE FROM legacy.app_categories WHERE appid = %s", (app.appid,))
            if category_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.app_categories (appid, category_id)
                    SELECT %s, unnest(%s::int[])
                    ON CONFLICT DO NOTHING
                    """,
                    (app.appid, category_ids),
                )

        if evidence.family_is_complete("genres"):
            genre_ids = list(
                dict.fromkeys(int(genre_id) for genre_id in app.genres if genre_id is not None)
            )
            if genre_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.steam_genres (genre_id, name)
                    SELECT genre_id, name
                    FROM jsonb_to_recordset(%s::jsonb)
                      AS rows(genre_id integer, name text)
                    ON CONFLICT (genre_id) DO UPDATE SET name = EXCLUDED.name
                    """,
                    (
                        json.dumps(
                            [
                                {
                                    "genre_id": genre_id,
                                    "name": GENRE_NAMES.get(genre_id, f"Genre {genre_id}"),
                                }
                                for genre_id in genre_ids
                            ]
                        ),
                    ),
                )
            cursor.execute("DELETE FROM legacy.app_genres WHERE appid = %s", (app.appid,))
            if genre_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.app_genres (appid, genre_id, is_primary)
                    SELECT %s, genre_id, coalesce(genre_id = %s, false)
                    FROM unnest(%s::int[]) AS genre_id
                    ON CONFLICT (appid, genre_id)
                    DO UPDATE SET is_primary = EXCLUDED.is_primary
                    """,
                    (app.appid, app.primary_genre, genre_ids),
                )

        if evidence.family_is_complete("store_tags"):
            tag_ids = list(
                dict.fromkeys(int(tag_id) for tag_id in app.store_tags if tag_id is not None)
            )
            if tag_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.steam_tags (tag_id, name, updated_at)
                    SELECT tag_id, concat('Tag ', tag_id), clock_timestamp()
                    FROM unnest(%s::int[]) AS tag_id
                    ON CONFLICT (tag_id) DO NOTHING
                    """,
                    (tag_ids,),
                )
            cursor.execute("DELETE FROM legacy.app_steam_tags WHERE appid = %s", (app.appid,))
            if tag_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.app_steam_tags (appid, tag_id, rank)
                    SELECT %s, tag_id, (rank - 1)::integer
                    FROM unnest(%s::int[]) WITH ORDINALITY AS tags(tag_id, rank)
                    ON CONFLICT (appid, tag_id)
                    DO UPDATE SET rank = EXCLUDED.rank
                    """,
                    (app.appid, tag_ids),
                )

        if evidence.family_is_complete("associations"):
            franchises = cls._association_names(app.associations, "franchise")
            cursor.execute("DELETE FROM legacy.app_franchises WHERE appid = %s", (app.appid,))
            for franchise_name in franchises:
                franchise_id = resolve_tiger_franchise_id(cursor, franchise_name)
                cursor.execute(
                    """
                    INSERT INTO legacy.app_franchises (appid, franchise_id)
                    VALUES (%s, %s)
                    ON CONFLICT DO NOTHING
                    """,
                    (app.appid, franchise_id),
                )

        if evidence.family_is_complete("dlc"):
            dlc_ids = sorted(
                {
                    int(dlc_id)
                    for dlc_id in app.dlc_appids
                    if int(dlc_id) > 0 and int(dlc_id) != app.appid
                }
            )
            cursor.execute(
                """
                DELETE FROM legacy.app_dlc
                WHERE parent_appid = %s
                  AND source = 'pics'
                """,
                (app.appid,),
            )
            if dlc_ids:
                cursor.execute(
                    """
                    INSERT INTO legacy.apps (appid, name, type, updated_at)
                    SELECT
                      dlc_id,
                      concat('Steam App ', dlc_id),
                      'dlc',
                      clock_timestamp()
                    FROM unnest(%s::int[]) AS dlc_id
                    ON CONFLICT (appid) DO NOTHING
                    """,
                    (dlc_ids,),
                )
                cursor.execute(
                    """
                    INSERT INTO legacy.app_dlc (parent_appid, dlc_appid, source)
                    SELECT %s, unnest(%s::int[]), 'pics'
                    ON CONFLICT (parent_appid, dlc_appid)
                    DO UPDATE SET source = EXCLUDED.source
                    """,
                    (app.appid, dlc_ids),
                )

    @staticmethod
    def _record_field_evidence(
        cursor: Any,
        *,
        app: ExtractedPICSData,
        source_change_number: int,
        source_at: datetime,
    ) -> None:
        """Retain source-specific values without promoting overall PICS readiness."""

        evidence = app.source_evidence
        if evidence is None:
            raise ValueError("Field evidence promotion requires PICS source evidence")

        category_values = [
            CATEGORY_NAMES.get(category_id, f"Category {category_id}")
            for category_id, enabled in sorted(app.categories.items())
            if enabled
        ]
        genre_values = [
            GENRE_NAMES.get(genre_id, f"Genre {genre_id}") for genre_id in dict.fromkeys(app.genres)
        ]
        tag_values: list[str] = []
        if evidence.family_is_complete("store_tags"):
            cursor.execute(
                """
                SELECT COALESCE(
                  array_agg(tag.name ORDER BY app_tag.rank),
                  ARRAY[]::text[]
                )
                FROM legacy.app_steam_tags app_tag
                JOIN legacy.steam_tags tag ON tag.tag_id = app_tag.tag_id
                WHERE app_tag.appid = %s
                """,
                (app.appid,),
            )
            tag_row = cursor.fetchone()
            tag_values = list(tag_row[0]) if tag_row and tag_row[0] else []
        language_values = (
            sorted(str(language) for language in app.languages)
            if isinstance(app.languages, dict)
            else []
        )
        deck_category = None
        if app.steam_deck is not None:
            deck_category = {
                0: "unknown",
                1: "unsupported",
                2: "playable",
                3: "verified",
            }.get(app.steam_deck.category, "unknown")

        records = []
        field_specs = (
            ("genres", evidence.family_is_complete("genres"), genre_values),
            ("categories", evidence.family_is_complete("categories"), category_values),
            ("tags", evidence.family_is_complete("store_tags"), tag_values),
            ("platforms", evidence.field_is_present("platforms"), list(app.platforms)),
            ("languages", evidence.field_is_present("languages"), language_values),
            (
                "controller_support",
                evidence.field_is_present("controller_support"),
                app.controller_support,
            ),
            ("steam_deck", evidence.field_is_present("steam_deck"), deck_category),
            (
                "content_descriptors",
                evidence.field_is_present("content_descriptors"),
                app.content_descriptors,
            ),
        )
        for field_name, present, value in field_specs:
            records.append(
                {
                    "field_name": field_name,
                    "evidence_state": "known" if present else "missing",
                    "value": value if present else None,
                    "provenance": {
                        "authority": "steam_pics",
                        "sourceChangeNumber": source_change_number,
                        "missingVersusEmptyPreserved": True,
                    },
                }
            )

        cursor.execute(
            """
            INSERT INTO ops.app_field_evidence (
              appid,
              field_name,
              source,
              evidence_state,
              value,
              source_at,
              version,
              provenance,
              created_at,
              updated_at
            )
            SELECT
              %s,
              input.field_name,
              'pics',
              input.evidence_state,
              CASE
                WHEN input.evidence_state = 'known'
                  THEN COALESCE(input.value, 'null'::jsonb)
                ELSE NULL
              END,
              %s,
              'steam-field-evidence/v1',
              input.provenance,
              clock_timestamp(),
              clock_timestamp()
            FROM jsonb_to_recordset(%s::jsonb) AS input(
              field_name text,
              evidence_state text,
              value jsonb,
              provenance jsonb
            )
            ON CONFLICT (appid, field_name, source)
            DO UPDATE SET
              evidence_state = EXCLUDED.evidence_state,
              value = EXCLUDED.value,
              source_at = EXCLUDED.source_at,
              version = EXCLUDED.version,
              provenance = EXCLUDED.provenance,
              updated_at = clock_timestamp()
            WHERE EXCLUDED.source_at >= ops.app_field_evidence.source_at
            """,
            (app.appid, source_at, json.dumps(records, sort_keys=True, default=str)),
        )

    @staticmethod
    def _update_sync_status(
        cursor: Any,
        *,
        appid: int,
        change_number: int,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO ops.sync_status (
              appid,
              last_pics_sync,
              pics_change_number,
              updated_at
            )
            VALUES (%s, clock_timestamp(), %s, clock_timestamp())
            ON CONFLICT (appid)
            DO UPDATE SET
              last_pics_sync = EXCLUDED.last_pics_sync,
              pics_change_number = greatest(
                coalesce(ops.sync_status.pics_change_number, 0),
                EXCLUDED.pics_change_number
              ),
              updated_at = clock_timestamp()
            """,
            (appid, change_number),
        )

    @staticmethod
    def _insert_events(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        snapshot_id: int,
        source_change_number: int,
        previous_pointer: Optional[PICSLatestSnapshot],
        archive: Optional[ArchivePointer],
        events: list[Any],
        observed_at: datetime,
    ) -> int:
        if not events:
            return 0
        if archive is None:
            raise ValueError("Changed PICS events require archive evidence")
        rows = [
            {
                "appid": claim.appid,
                "source": "pics",
                "change_type": event.change_type,
                "occurred_at": observed_at.isoformat(),
                "source_snapshot_id": snapshot_id,
                "related_snapshot_id": previous_pointer.id if previous_pointer else None,
                "before_value": event.before_value,
                "after_value": event.after_value,
                "context": {
                    **event.context,
                    "workId": claim.id,
                    "streamKey": claim.stream_key,
                    "claimedThroughChangeNumber": (claim.claimed_through_change_number),
                    "sourceChangeNumber": source_change_number,
                    **(
                        {"reconciliationRunId": str(claim.reconciliation_run_id)}
                        if claim.reconciliation_run_id is not None
                        else {}
                    ),
                },
                "trigger_cursor": str(source_change_number),
            }
            for event in events
        ]
        cursor.execute(
            """
            INSERT INTO events.app_change_events (
              appid,
              source,
              change_type,
              occurred_at,
              source_snapshot_id,
              related_snapshot_id,
              before_value,
              after_value,
              context,
              trigger_cursor,
              evidence_archive_bucket,
              evidence_archive_key,
              evidence_archive_content_hash,
              evidence_archive_byte_size,
              evidence_archive_content_type,
              evidence_archived_at
            )
            SELECT
              appid,
              source,
              change_type,
              occurred_at,
              source_snapshot_id,
              related_snapshot_id,
              before_value,
              after_value,
              coalesce(rows.context, '{}'::jsonb)
                || jsonb_build_object(
                  'event_registry_known', registry.is_known,
                  'event_registry_version', registry.registry_version,
                  'signal_family', registry.signal_family
                ),
              trigger_cursor,
              %s,
              %s,
              %s,
              %s,
              %s,
              clock_timestamp()
            FROM jsonb_to_recordset(%s::jsonb) AS rows (
              appid integer,
              source text,
              change_type text,
              occurred_at timestamptz,
              source_snapshot_id bigint,
              related_snapshot_id bigint,
              before_value jsonb,
              after_value jsonb,
              context jsonb,
              trigger_cursor text
            )
            CROSS JOIN LATERAL events.resolve_change_event_v1(
              rows.source,
              rows.change_type
            ) registry
            """,
            (
                archive.bucket,
                archive.key,
                archive.content_hash,
                archive.byte_size,
                archive.content_type,
                json.dumps(rows, sort_keys=True, default=str),
            ),
        )
        return int(cursor.rowcount)

    @staticmethod
    def _association_names(
        associations: list[Association],
        association_type: str,
    ) -> list[str]:
        return sorted(
            {
                association.name.strip()
                for association in associations
                if association.type == association_type and association.name.strip()
            }
        )
