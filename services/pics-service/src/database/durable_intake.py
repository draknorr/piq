"""Transactional Tiger storage for durable Steam PICS change intake."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Sequence
from uuid import UUID


class PICSDurableIntakeError(RuntimeError):
    """Base error for durable PICS intake failures."""


class PICSCursorMismatchError(PICSDurableIntakeError):
    """Raised when a batch does not begin at the durable stream cursor."""


class PICSBatchReconciliationError(PICSDurableIntakeError):
    """Raised when staged or persisted batch items do not match the source."""


@dataclass(frozen=True)
class PICSSourceAppChange:
    """One ordered app entry from an upstream PICS changes-since response."""

    appid: int
    change_number: int
    needs_token: bool


@dataclass(frozen=True)
class PICSArchiveReference:
    """Required immutable archive reference for a PICS change response."""

    bucket: str
    key: str
    content_hash: str
    byte_size: int
    content_type: str


@dataclass(frozen=True)
class PersistedPICSBatch:
    """Committed durable intake result."""

    batch_id: UUID
    stream_key: str
    work_mode: str
    lane: str
    from_change_number: int
    to_change_number: int
    response_since_change_number: int
    source_app_count: int
    distinct_app_count: int
    durable_app_count: int
    app_changes_sha256: str
    force_full_update: bool
    force_full_app_update: bool
    force_full_package_update: bool
    source_complete: bool
    status: str
    primary_cursor_advanced: bool
    idempotent_replay: bool


def hash_pics_app_changes(changes: Sequence[PICSSourceAppChange]) -> str:
    """Hash exact ordered PICS app entries, including source metadata."""

    digest = hashlib.sha256()
    for source_index, change in enumerate(changes):
        appid = int(change.appid)
        change_number = int(change.change_number)
        if appid <= 0:
            raise ValueError(f"PICS app IDs must be positive integers; received {appid}")
        if change_number < 0:
            raise ValueError(
                "PICS app change numbers must be nonnegative; "
                f"received {change_number} for app {appid}"
            )
        needs_token = 1 if bool(change.needs_token) else 0
        digest.update(f"{source_index}:{appid}:{change_number}:{needs_token}\n".encode("ascii"))
    return digest.hexdigest()


class TigerPICSDurableIntakeStore:
    """Persist an upstream PICS response and cursor in one Tiger transaction."""

    _VALID_WORK_MODES = frozenset({"shadow", "durable"})
    _VALID_LANES = frozenset({"live", "catchup"})

    def __init__(
        self,
        database_url: str,
        *,
        statement_timeout_seconds: int = 60,
        lock_timeout_seconds: int = 10,
        connection_factory: Optional[Callable[[], Any]] = None,
    ):
        if not database_url and connection_factory is None:
            raise ValueError("A Tiger database URL is required for durable PICS intake")
        self._database_url = database_url
        self._statement_timeout_seconds = max(1, int(statement_timeout_seconds))
        self._lock_timeout_seconds = max(1, int(lock_timeout_seconds))
        self._connection_factory = connection_factory

    @classmethod
    def from_settings(cls, settings: Any) -> "TigerPICSDurableIntakeStore":
        database_url = settings.pics_intake_tiger_url or settings.tiger_primary_url
        if not database_url:
            raise ValueError(
                "PICS_WORK_MODE=shadow|durable requires PICS_INTAKE_TIGER_URL or TIGER_PRIMARY_URL"
            )
        return cls(
            database_url,
            statement_timeout_seconds=settings.pics_intake_statement_timeout_seconds,
            lock_timeout_seconds=settings.pics_intake_lock_timeout_seconds,
        )

    def _connect(self) -> Any:
        if self._connection_factory is not None:
            return self._connection_factory()

        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError(
                "Durable PICS intake requires psycopg. Install pics-service dependencies."
            ) from error

        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-durable-intake",
        )

    def get_start_change_number(
        self,
        *,
        work_mode: str,
        stream_key: str,
        shadow_start_change_number: Optional[int] = None,
    ) -> int:
        """Resolve the restart-safe cursor for a primary or shadow intake stream."""

        normalized_mode, normalized_stream, _ = self._validate_stream(
            work_mode=work_mode,
            stream_key=stream_key,
            lane="live",
        )

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if normalized_mode == "durable":
                    cursor.execute(
                        "SELECT last_change_number FROM ops.pics_sync_state WHERE id = 1"
                    )
                    row = cursor.fetchone()
                    if row is None:
                        raise PICSDurableIntakeError(
                            "ops.pics_sync_state row id=1 is missing; "
                            "initialize it only in an approved Tiger write window"
                        )
                    return int(row[0])

                cursor.execute(
                    """
                    SELECT to_change_number
                    FROM ops.pics_change_batches
                    WHERE stream_key = %s
                      AND work_mode = 'shadow'
                      AND source_complete
                    ORDER BY to_change_number DESC
                    LIMIT 1
                    """,
                    (normalized_stream,),
                )
                row = cursor.fetchone()
                if row is not None:
                    return int(row[0])

        if shadow_start_change_number is None:
            raise PICSDurableIntakeError(
                "A new shadow stream requires PICS_SHADOW_START_CHANGE_NUMBER"
            )
        if int(shadow_start_change_number) < 0:
            raise ValueError("PICS_SHADOW_START_CHANGE_NUMBER must be nonnegative")
        return int(shadow_start_change_number)

    def persist_batch(
        self,
        *,
        archive: PICSArchiveReference,
        from_change_number: int,
        to_change_number: int,
        response_since_change_number: int,
        app_changes: Sequence[PICSSourceAppChange],
        force_full_update: bool,
        force_full_app_update: bool,
        force_full_package_update: bool,
        work_mode: str,
        stream_key: str,
        lane: str = "live",
        received_at: Optional[datetime] = None,
    ) -> PersistedPICSBatch:
        """Persist one complete upstream response and conditionally advance the cursor."""

        normalized_mode, normalized_stream, normalized_lane = self._validate_stream(
            work_mode=work_mode,
            stream_key=stream_key,
            lane=lane,
        )
        source_cursor = int(from_change_number)
        target_cursor = int(to_change_number)
        response_cursor = int(response_since_change_number)
        if source_cursor < 0:
            raise ValueError("from_change_number must be nonnegative")
        if target_cursor <= source_cursor:
            raise ValueError("to_change_number must be greater than from_change_number")
        if response_cursor < 0:
            raise ValueError("response_since_change_number must be nonnegative")

        normalized_changes = tuple(self._normalize_app_change(change) for change in app_changes)
        global_force_full = bool(force_full_update)
        app_force_full = bool(force_full_app_update)
        package_force_full = bool(force_full_package_update)
        source_complete = (
            response_cursor == source_cursor and not global_force_full and not app_force_full
        )
        self._validate_change_range(
            normalized_changes,
            from_change_number=source_cursor,
            to_change_number=target_cursor,
            source_complete=source_complete,
        )
        app_changes_sha256 = hash_pics_app_changes(normalized_changes)
        source_app_count = len(normalized_changes)
        distinct_app_count = len({change.appid for change in normalized_changes})
        batch_status = "committed" if source_complete else "source_blocked"
        observed_at = received_at or datetime.now(timezone.utc)
        if observed_at.tzinfo is None:
            observed_at = observed_at.replace(tzinfo=timezone.utc)
        self._validate_archive(archive)

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    cursor.execute(
                        "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                        (f"pics-intake:{normalized_stream}",),
                    )

                    primary_cursor: Optional[int] = None
                    if normalized_mode == "durable":
                        primary_cursor = self._lock_primary_cursor(cursor)

                    existing = self._find_existing_batch(
                        cursor,
                        stream_key=normalized_stream,
                        from_change_number=source_cursor,
                        to_change_number=target_cursor,
                    )
                    if existing is not None:
                        self._validate_existing_batch(
                            existing=existing,
                            work_mode=normalized_mode,
                            lane=normalized_lane,
                            response_since_change_number=response_cursor,
                            source_app_count=source_app_count,
                            distinct_app_count=distinct_app_count,
                            app_changes_sha256=app_changes_sha256,
                            force_full_update=global_force_full,
                            force_full_app_update=app_force_full,
                            force_full_package_update=package_force_full,
                            source_complete=source_complete,
                            status=batch_status,
                            archive=archive,
                            primary_cursor=primary_cursor,
                            from_change_number=source_cursor,
                            to_change_number=target_cursor,
                        )
                        replay_count, replay_distinct, replay_hash = self._read_durable_manifest(
                            cursor,
                            batch_id=UUID(str(existing[0])),
                        )
                        self._assert_manifest(
                            location="replayed durable",
                            expected_count=source_app_count,
                            expected_distinct=distinct_app_count,
                            expected_hash=app_changes_sha256,
                            actual_count=replay_count,
                            actual_distinct=replay_distinct,
                            actual_hash=replay_hash,
                        )
                        return PersistedPICSBatch(
                            batch_id=UUID(str(existing[0])),
                            stream_key=normalized_stream,
                            work_mode=normalized_mode,
                            lane=normalized_lane,
                            from_change_number=source_cursor,
                            to_change_number=target_cursor,
                            response_since_change_number=response_cursor,
                            source_app_count=source_app_count,
                            distinct_app_count=distinct_app_count,
                            durable_app_count=replay_count,
                            app_changes_sha256=app_changes_sha256,
                            force_full_update=global_force_full,
                            force_full_app_update=app_force_full,
                            force_full_package_update=package_force_full,
                            source_complete=source_complete,
                            status=batch_status,
                            primary_cursor_advanced=bool(existing[13]),
                            idempotent_replay=True,
                        )

                    self._assert_contiguous_cursor(
                        cursor,
                        work_mode=normalized_mode,
                        stream_key=normalized_stream,
                        from_change_number=source_cursor,
                        primary_cursor=primary_cursor,
                    )
                    self._stage_batch_apps(cursor, normalized_changes)
                    staged_count, staged_distinct, staged_hash = self._read_staged_manifest(cursor)
                    self._assert_manifest(
                        location="staged",
                        expected_count=source_app_count,
                        expected_distinct=distinct_app_count,
                        expected_hash=app_changes_sha256,
                        actual_count=staged_count,
                        actual_distinct=staged_distinct,
                        actual_hash=staged_hash,
                    )

                    batch_id = self._insert_batch(
                        cursor,
                        stream_key=normalized_stream,
                        work_mode=normalized_mode,
                        lane=normalized_lane,
                        from_change_number=source_cursor,
                        to_change_number=target_cursor,
                        response_since_change_number=response_cursor,
                        received_at=observed_at,
                        source_app_count=source_app_count,
                        distinct_app_count=distinct_app_count,
                        app_changes_sha256=app_changes_sha256,
                        force_full_update=global_force_full,
                        force_full_app_update=app_force_full,
                        force_full_package_update=package_force_full,
                        source_complete=source_complete,
                        status=batch_status,
                        archive=archive,
                    )
                    cursor.execute(
                        """
                        INSERT INTO ops.pics_change_batch_apps (
                          batch_id,
                          source_index,
                          appid,
                          source_change_number,
                          needs_token
                        )
                        SELECT
                          %s,
                          source_index,
                          appid,
                          source_change_number,
                          needs_token
                        FROM pics_batch_stage
                        ORDER BY source_index
                        """,
                        (batch_id,),
                    )

                    durable_count, durable_distinct, durable_hash = self._read_durable_manifest(
                        cursor,
                        batch_id=batch_id,
                    )
                    self._assert_manifest(
                        location="durable",
                        expected_count=source_app_count,
                        expected_distinct=distinct_app_count,
                        expected_hash=app_changes_sha256,
                        actual_count=durable_count,
                        actual_distinct=durable_distinct,
                        actual_hash=durable_hash,
                    )

                    if source_complete:
                        self._upsert_work(
                            cursor,
                            batch_id=batch_id,
                            stream_key=normalized_stream,
                            work_mode=normalized_mode,
                            lane=normalized_lane,
                            received_at=observed_at,
                        )
                    if normalized_mode == "durable" and source_complete:
                        self._mark_pics_readiness_pending(
                            cursor,
                            batch_id=batch_id,
                            to_change_number=target_cursor,
                            received_at=observed_at,
                        )
                        cursor.execute(
                            """
                            UPDATE ops.pics_sync_state
                            SET last_change_number = %s,
                                updated_at = clock_timestamp()
                            WHERE id = 1
                              AND last_change_number = %s
                            """,
                            (target_cursor, source_cursor),
                        )
                        if cursor.rowcount != 1:
                            raise PICSCursorMismatchError(
                                "Primary PICS cursor changed before batch commit"
                            )

                    return PersistedPICSBatch(
                        batch_id=UUID(str(batch_id)),
                        stream_key=normalized_stream,
                        work_mode=normalized_mode,
                        lane=normalized_lane,
                        from_change_number=source_cursor,
                        to_change_number=target_cursor,
                        response_since_change_number=response_cursor,
                        source_app_count=source_app_count,
                        distinct_app_count=distinct_app_count,
                        durable_app_count=durable_count,
                        app_changes_sha256=app_changes_sha256,
                        force_full_update=global_force_full,
                        force_full_app_update=app_force_full,
                        force_full_package_update=package_force_full,
                        source_complete=source_complete,
                        status=batch_status,
                        primary_cursor_advanced=(normalized_mode == "durable" and source_complete),
                        idempotent_replay=False,
                    )

    def _validate_stream(
        self,
        *,
        work_mode: str,
        stream_key: str,
        lane: str,
    ) -> tuple[str, str, str]:
        normalized_mode = work_mode.strip().lower()
        normalized_stream = stream_key.strip()
        normalized_lane = lane.strip().lower()
        if normalized_mode not in self._VALID_WORK_MODES:
            raise ValueError(f"Unsupported PICS work mode: {work_mode}")
        if not normalized_stream:
            raise ValueError("PICS intake stream_key is required")
        if len(normalized_stream) > 128:
            raise ValueError("PICS intake stream_key must be 128 characters or fewer")
        if normalized_mode == "durable" and normalized_stream != "primary":
            raise ValueError("Durable PICS intake must use stream_key='primary'")
        if normalized_mode == "shadow" and normalized_stream == "primary":
            raise ValueError("Shadow PICS intake must use a non-primary stream key")
        if normalized_lane not in self._VALID_LANES:
            raise ValueError(f"Unsupported PICS intake lane: {lane}")
        return normalized_mode, normalized_stream, normalized_lane

    @staticmethod
    def _normalize_app_change(change: PICSSourceAppChange) -> PICSSourceAppChange:
        try:
            return PICSSourceAppChange(
                appid=int(change.appid),
                change_number=int(change.change_number),
                needs_token=bool(change.needs_token),
            )
        except AttributeError as error:
            raise TypeError(
                "Each PICS app change requires appid, change_number, and needs_token"
            ) from error

    @staticmethod
    def _validate_change_range(
        app_changes: Sequence[PICSSourceAppChange],
        *,
        from_change_number: int,
        to_change_number: int,
        source_complete: bool,
    ) -> None:
        for change in app_changes:
            if change.appid <= 0:
                raise ValueError(f"PICS app IDs must be positive integers; received {change.appid}")
            lower_bound_valid = (
                change.change_number > from_change_number
                if source_complete
                else change.change_number >= 0
            )
            if not lower_bound_valid or change.change_number > to_change_number:
                raise PICSBatchReconciliationError(
                    "PICS app change number falls outside the response cursor range: "
                    f"app {change.appid}, change {change.change_number}, "
                    f"range ({from_change_number}, {to_change_number}]"
                )

    @staticmethod
    def _validate_archive(archive: PICSArchiveReference) -> None:
        if archive is None:
            raise ValueError("PICS archive reference is required before intake")
        if (
            not archive.bucket.strip()
            or not archive.key.strip()
            or not archive.content_type.strip()
        ):
            raise ValueError("PICS archive bucket, key, and content type are required")
        if len(archive.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in archive.content_hash
        ):
            raise ValueError("PICS archive content_hash must be lowercase SHA-256")
        if archive.byte_size < 0:
            raise ValueError("PICS archive byte_size must be nonnegative")

    def _configure_transaction(self, cursor: Any) -> None:
        cursor.execute(
            "SELECT set_config('statement_timeout', %s, true)",
            (f"{self._statement_timeout_seconds}s",),
        )
        cursor.execute(
            "SELECT set_config('lock_timeout', %s, true)",
            (f"{self._lock_timeout_seconds}s",),
        )

    @staticmethod
    def _lock_primary_cursor(cursor: Any) -> int:
        cursor.execute(
            """
            SELECT last_change_number
            FROM ops.pics_sync_state
            WHERE id = 1
            FOR UPDATE
            """
        )
        row = cursor.fetchone()
        if row is None:
            raise PICSDurableIntakeError(
                "ops.pics_sync_state row id=1 is missing; "
                "initialize it only in an approved Tiger write window"
            )
        return int(row[0])

    @staticmethod
    def _find_existing_batch(
        cursor: Any,
        *,
        stream_key: str,
        from_change_number: int,
        to_change_number: int,
    ) -> Optional[tuple[Any, ...]]:
        cursor.execute(
            """
            SELECT
              id,
              work_mode,
              lane,
              response_since_change_number,
              source_app_count,
              distinct_app_count,
              durable_app_count,
              app_changes_sha256,
              force_full_update,
              force_full_app_update,
              force_full_package_update,
              source_complete,
              status,
              primary_cursor_advanced,
              archive_bucket,
              archive_key,
              archive_content_hash,
              archive_byte_size,
              archive_content_type
            FROM ops.pics_change_batches
            WHERE stream_key = %s
              AND from_change_number = %s
              AND to_change_number = %s
            """,
            (stream_key, from_change_number, to_change_number),
        )
        return cursor.fetchone()

    @staticmethod
    def _validate_existing_batch(
        *,
        existing: tuple[Any, ...],
        work_mode: str,
        lane: str,
        response_since_change_number: int,
        source_app_count: int,
        distinct_app_count: int,
        app_changes_sha256: str,
        force_full_update: bool,
        force_full_app_update: bool,
        force_full_package_update: bool,
        source_complete: bool,
        status: str,
        archive: PICSArchiveReference,
        primary_cursor: Optional[int],
        from_change_number: int,
        to_change_number: int,
    ) -> None:
        expected = (
            work_mode,
            lane,
            response_since_change_number,
            source_app_count,
            distinct_app_count,
            source_app_count,
            app_changes_sha256,
            force_full_update,
            force_full_app_update,
            force_full_package_update,
            source_complete,
            status,
            work_mode == "durable" and source_complete,
        )
        actual = (
            str(existing[1]),
            str(existing[2]),
            int(existing[3]),
            int(existing[4]),
            int(existing[5]),
            int(existing[6]),
            str(existing[7]),
            bool(existing[8]),
            bool(existing[9]),
            bool(existing[10]),
            bool(existing[11]),
            str(existing[12]),
            bool(existing[13]),
        )
        if actual != expected:
            raise PICSBatchReconciliationError(
                "Existing PICS batch does not match the replayed source manifest"
            )
        if any(existing[index] is None for index in range(14, 19)):
            raise PICSBatchReconciliationError(
                "Existing PICS batch is missing its required archive"
            )
        existing_archive = (
            str(existing[14]),
            str(existing[16]),
            int(existing[17]),
            str(existing[18]),
        )
        expected_archive = (
            archive.bucket,
            archive.content_hash,
            archive.byte_size,
            archive.content_type,
        )
        if not existing[15] or existing_archive != expected_archive:
            raise PICSBatchReconciliationError(
                "Existing PICS batch does not match the replayed archive"
            )
        expected_primary_cursor = to_change_number if source_complete else from_change_number
        if work_mode == "durable" and primary_cursor != expected_primary_cursor:
            raise PICSCursorMismatchError(
                "Existing durable batch is present but the primary cursor does not match it"
            )

    @staticmethod
    def _assert_contiguous_cursor(
        cursor: Any,
        *,
        work_mode: str,
        stream_key: str,
        from_change_number: int,
        primary_cursor: Optional[int],
    ) -> None:
        if work_mode == "durable":
            if primary_cursor != from_change_number:
                raise PICSCursorMismatchError(
                    f"Primary PICS cursor is {primary_cursor}, "
                    f"but the batch begins at {from_change_number}"
                )
            return

        cursor.execute(
            """
            SELECT to_change_number
            FROM ops.pics_change_batches
            WHERE stream_key = %s
              AND work_mode = 'shadow'
              AND source_complete
            ORDER BY to_change_number DESC
            LIMIT 1
            """,
            (stream_key,),
        )
        row = cursor.fetchone()
        if row is not None and int(row[0]) != from_change_number:
            raise PICSCursorMismatchError(
                f"Shadow PICS stream {stream_key!r} ends at {int(row[0])}, "
                f"but the batch begins at {from_change_number}"
            )

    @staticmethod
    def _stage_batch_apps(
        cursor: Any,
        app_changes: Sequence[PICSSourceAppChange],
    ) -> None:
        cursor.execute(
            """
            CREATE TEMP TABLE pics_batch_stage (
              source_index integer PRIMARY KEY,
              appid integer NOT NULL CHECK (appid > 0),
              source_change_number bigint NOT NULL CHECK (
                source_change_number >= 0
              ),
              needs_token boolean NOT NULL
            ) ON COMMIT DROP
            """
        )
        with cursor.copy(
            """
            COPY pics_batch_stage (
              source_index,
              appid,
              source_change_number,
              needs_token
            ) FROM STDIN (FORMAT BINARY)
            """
        ) as copy:
            copy.set_types(["int4", "int4", "int8", "bool"])
            for source_index, change in enumerate(app_changes):
                copy.write_row(
                    (
                        source_index,
                        change.appid,
                        change.change_number,
                        change.needs_token,
                    )
                )

    @staticmethod
    def _read_staged_manifest(cursor: Any) -> tuple[int, int, str]:
        cursor.execute(
            """
            SELECT
              count(*)::integer,
              count(DISTINCT appid)::integer,
              encode(
                digest(
                  coalesce(
                    string_agg(
                      source_index::text || ':' ||
                      appid::text || ':' ||
                      source_change_number::text || ':' ||
                      CASE WHEN needs_token THEN '1' ELSE '0' END ||
                      E'\n',
                      ''
                      ORDER BY source_index
                    ),
                    ''
                  ),
                  'sha256'
                ),
                'hex'
              )
            FROM pics_batch_stage
            """
        )
        row = cursor.fetchone()
        return int(row[0]), int(row[1]), str(row[2])

    @staticmethod
    def _insert_batch(
        cursor: Any,
        *,
        stream_key: str,
        work_mode: str,
        lane: str,
        from_change_number: int,
        to_change_number: int,
        response_since_change_number: int,
        received_at: datetime,
        source_app_count: int,
        distinct_app_count: int,
        app_changes_sha256: str,
        force_full_update: bool,
        force_full_app_update: bool,
        force_full_package_update: bool,
        source_complete: bool,
        status: str,
        archive: PICSArchiveReference,
    ) -> UUID:
        cursor.execute(
            """
            INSERT INTO ops.pics_change_batches (
              stream_key,
              work_mode,
              lane,
              from_change_number,
              to_change_number,
              response_since_change_number,
              received_at,
              source_app_count,
              distinct_app_count,
              durable_app_count,
              app_changes_sha256,
              force_full_update,
              force_full_app_update,
              force_full_package_update,
              source_complete,
              archive_bucket,
              archive_key,
              archive_content_hash,
              archive_byte_size,
              archive_content_type,
              primary_cursor_advanced,
              status,
              created_at,
              updated_at
            )
            VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s,
              clock_timestamp(), clock_timestamp()
            )
            RETURNING id
            """,
            (
                stream_key,
                work_mode,
                lane,
                from_change_number,
                to_change_number,
                response_since_change_number,
                received_at,
                source_app_count,
                distinct_app_count,
                source_app_count,
                app_changes_sha256,
                force_full_update,
                force_full_app_update,
                force_full_package_update,
                source_complete,
                archive.bucket,
                archive.key,
                archive.content_hash,
                archive.byte_size,
                archive.content_type,
                work_mode == "durable" and source_complete,
                status,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise PICSDurableIntakeError("Tiger did not return a PICS batch ID")
        return UUID(str(row[0]))

    @staticmethod
    def _read_durable_manifest(cursor: Any, *, batch_id: UUID) -> tuple[int, int, str]:
        cursor.execute(
            """
            SELECT
              count(*)::integer,
              count(DISTINCT appid)::integer,
              encode(
                digest(
                  coalesce(
                    string_agg(
                      source_index::text || ':' ||
                      appid::text || ':' ||
                      source_change_number::text || ':' ||
                      CASE WHEN needs_token THEN '1' ELSE '0' END ||
                      E'\n',
                      ''
                      ORDER BY source_index
                    ),
                    ''
                  ),
                  'sha256'
                ),
                'hex'
              )
            FROM ops.pics_change_batch_apps
            WHERE batch_id = %s
            """,
            (batch_id,),
        )
        row = cursor.fetchone()
        return int(row[0]), int(row[1]), str(row[2])

    @staticmethod
    def _assert_manifest(
        *,
        location: str,
        expected_count: int,
        expected_distinct: int,
        expected_hash: str,
        actual_count: int,
        actual_distinct: int,
        actual_hash: str,
    ) -> None:
        if (
            actual_count != expected_count
            or actual_distinct != expected_distinct
            or actual_hash != expected_hash
        ):
            raise PICSBatchReconciliationError(
                f"{location.capitalize()} PICS batch manifest does not match the source"
            )

    @staticmethod
    def _upsert_work(
        cursor: Any,
        *,
        batch_id: UUID,
        stream_key: str,
        work_mode: str,
        lane: str,
        received_at: datetime,
    ) -> None:
        cursor.execute(
            """
            WITH incoming AS (
              SELECT
                staged.appid,
                staged.first_change_number,
                staged.latest_change_number,
                CASE
                  WHEN catalog.first_observation_kind = 'new'
                    AND sync.last_pics_sync IS NULL THEN 'new'
                  ELSE %s
                END AS lane,
                CASE
                  WHEN catalog.first_observation_kind = 'new'
                    AND sync.last_pics_sync IS NULL THEN 300
                  WHEN %s = 'live' THEN 200
                  ELSE 100
                END AS priority
              FROM (
                SELECT
                  appid,
                  min(source_change_number) AS first_change_number,
                  max(source_change_number) AS latest_change_number
                FROM pics_batch_stage
                GROUP BY appid
              ) staged
              LEFT JOIN ops.sync_status sync ON sync.appid = staged.appid
              LEFT JOIN ops.app_catalog_state catalog ON catalog.appid = staged.appid
            )
            INSERT INTO ops.pics_work_state (
              appid,
              stream_key,
              work_mode,
              lane,
              priority,
              state,
              first_batch_id,
              latest_batch_id,
              first_change_number,
              latest_change_number,
              dirty_since,
              last_dirty_at,
              attempts,
              max_attempts,
              next_attempt_at,
              created_at,
              updated_at
            )
            SELECT
              incoming.appid,
              %s,
              %s,
              incoming.lane,
              incoming.priority,
              'pending',
              %s,
              %s,
              incoming.first_change_number,
              incoming.latest_change_number,
              %s,
              %s,
              0,
              8,
              clock_timestamp(),
              clock_timestamp(),
              clock_timestamp()
            FROM incoming
            ON CONFLICT (appid, stream_key)
            DO UPDATE SET
              lane = CASE
                WHEN EXCLUDED.lane = 'new' THEN 'new'
                WHEN ops.pics_work_state.state IN (
                  'completed',
                  'dead_letter',
                  'source_blocked'
                ) THEN EXCLUDED.lane
                WHEN ops.pics_work_state.lane = 'new' THEN 'new'
                WHEN ops.pics_work_state.lane = 'live' OR EXCLUDED.lane = 'live' THEN 'live'
                ELSE 'catchup'
              END,
              priority = CASE
                WHEN ops.pics_work_state.state IN (
                  'completed',
                  'dead_letter',
                  'source_blocked'
                ) THEN EXCLUDED.priority
                ELSE greatest(ops.pics_work_state.priority, EXCLUDED.priority)
              END,
              first_batch_id = coalesce(
                ops.pics_work_state.first_batch_id,
                EXCLUDED.first_batch_id
              ),
              latest_batch_id = EXCLUDED.latest_batch_id,
              reconciliation_run_id = CASE
                WHEN ops.pics_work_state.reconciliation_run_id IS NULL THEN NULL
                WHEN EXISTS (
                  SELECT 1
                  FROM ops.pics_reconciliation_runs reconciliation
                  WHERE reconciliation.id =
                    ops.pics_work_state.reconciliation_run_id
                    AND reconciliation.status = 'active'
                ) THEN ops.pics_work_state.reconciliation_run_id
                ELSE NULL
              END,
              latest_change_number = greatest(
                ops.pics_work_state.latest_change_number,
                EXCLUDED.latest_change_number
              ),
              dirty_since = least(ops.pics_work_state.dirty_since, EXCLUDED.dirty_since),
              last_dirty_at = greatest(
                ops.pics_work_state.last_dirty_at,
                EXCLUDED.last_dirty_at
              ),
              state = CASE
                WHEN ops.pics_work_state.state = 'claimed' THEN 'claimed'
                ELSE 'pending'
              END,
              claimed_through_change_number = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.claimed_through_change_number
                ELSE NULL
              END,
              claimed_at = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.claimed_at
                ELSE NULL
              END,
              claim_expires_at = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.claim_expires_at
                ELSE NULL
              END,
              heartbeat_at = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.heartbeat_at
                ELSE NULL
              END,
              worker_id = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.worker_id
                ELSE NULL
              END,
              attempts = CASE
                WHEN ops.pics_work_state.state IN (
                  'completed',
                  'dead_letter',
                  'source_blocked'
                ) THEN 0
                ELSE ops.pics_work_state.attempts
              END,
              next_attempt_at = CASE
                WHEN ops.pics_work_state.state = 'claimed'
                  THEN ops.pics_work_state.next_attempt_at
                ELSE clock_timestamp()
              END,
              dead_lettered_at = NULL,
              last_error_code = NULL,
              last_error_message = NULL,
              updated_at = clock_timestamp()
            """,
            (
                lane,
                lane,
                stream_key,
                work_mode,
                batch_id,
                batch_id,
                received_at,
                received_at,
            ),
        )
        if work_mode == "durable":
            cursor.execute(
                """
                UPDATE ops.pics_reconciliation_items items
                SET status = 'pending',
                    completed_snapshot_id = NULL,
                    source_change_number = NULL,
                    last_error_code = NULL,
                    last_error_message = NULL,
                    disposition = NULL,
                    requeue_count = items.requeue_count + 1,
                    last_requeued_at = clock_timestamp(),
                    last_requeued_by = 'durable_live_intake',
                    last_requeue_reason =
                      'newer source batch ' || %s::text,
                    completed_at = NULL,
                    updated_at = clock_timestamp()
                FROM ops.pics_work_state work
                JOIN ops.pics_reconciliation_runs reconciliation
                  ON reconciliation.id = work.reconciliation_run_id
                 AND reconciliation.status = 'active'
                WHERE items.run_id = work.reconciliation_run_id
                  AND items.appid = work.appid
                  AND work.latest_batch_id = %s
                  AND items.status IN (
                    'completed',
                    'source_blocked',
                    'dead_letter'
                  )
                """,
                (batch_id, batch_id),
            )

    @staticmethod
    def _mark_pics_readiness_pending(
        cursor: Any,
        *,
        batch_id: UUID,
        to_change_number: int,
        received_at: datetime,
    ) -> None:
        cursor.execute(
            """
            INSERT INTO ops.app_data_readiness (
              appid,
              source,
              status,
              source_at,
              processed_at,
              version,
              blocking_reason,
              retryable,
              provenance,
              created_at,
              updated_at
            )
            SELECT
              staged.appid,
              'pics',
              'pending',
              %s,
              NULL,
              'pics-readiness/v1',
              'awaiting_pics_processing',
              true,
              jsonb_build_object(
                'batch_id', %s::text,
                'change_number', %s
              ),
              clock_timestamp(),
              clock_timestamp()
            FROM (
              SELECT appid
              FROM pics_batch_stage
              GROUP BY appid
            ) staged
            ON CONFLICT (appid, source)
            DO UPDATE SET
              status = 'pending',
              source_at = EXCLUDED.source_at,
              processed_at = NULL,
              version = EXCLUDED.version,
              blocking_reason = EXCLUDED.blocking_reason,
              retryable = true,
              provenance = EXCLUDED.provenance,
              updated_at = clock_timestamp()
            WHERE ops.app_data_readiness.source_at IS NULL
               OR EXCLUDED.source_at >= ops.app_data_readiness.source_at
            """,
            (received_at, batch_id, to_change_number),
        )
