"""Leased Tiger work-state operations for durable PICS processing."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Sequence
from uuid import UUID


class PICSWorkStateError(RuntimeError):
    """A durable work claim no longer matches Tiger state."""


@dataclass(frozen=True)
class PICSWorkClaim:
    """One leased app work item."""

    id: int
    appid: int
    stream_key: str
    work_mode: str
    lane: str
    priority: int
    claimed_through_change_number: int
    attempts: int
    max_attempts: int
    claim_expires_at: datetime
    worker_id: str
    needs_token: bool = False
    reconciliation_run_id: Optional[UUID] = None


@dataclass(frozen=True)
class PICSLatestSnapshot:
    """Relational pointer to the latest archived PICS snapshot."""

    id: int
    content_hash: str
    archive_bucket: str
    archive_key: str
    archive_content_hash: str


@dataclass(frozen=True)
class PICSQueueMetrics:
    """Bounded queue and recent-settlement snapshot for one stream."""

    observed_at: datetime
    live_open: int
    catchup_open: int
    retrying: int
    claimed: int
    dead_letter: int
    missing_access_token: int
    catchup_settled_last_hour: int
    catchup_settlements_per_minute: float
    catchup_eta_hours: Optional[float]


@dataclass(frozen=True)
class PICSTokenReplayCandidate:
    """Read-only recovery report for one token-blocked app."""

    work_id: int
    appid: int
    stream_key: str
    lane: str
    latest_change_number: int
    needs_token: bool
    blocked_at: datetime
    storefront_status: Optional[str]
    storefront_source_at: Optional[datetime]
    storefront_field_coverage: Dict[str, str]
    storefront_snapshot_summary: Dict[str, Any]


class TigerPICSDurableWorkStore:
    """Claim and settle PICS app work using bounded PostgreSQL leases."""

    _VALID_WORK_MODES = frozenset({"shadow", "durable"})
    _VALID_LANE_GROUPS = {
        "live": ("new", "live"),
        "catchup": ("catchup",),
    }

    def __init__(
        self,
        database_url: str,
        *,
        statement_timeout_seconds: int = 60,
        lock_timeout_seconds: int = 10,
        connection_factory: Optional[Callable[[], Any]] = None,
    ):
        if not database_url and connection_factory is None:
            raise ValueError("A Tiger database URL is required for durable PICS work")
        self._database_url = database_url
        self._statement_timeout_seconds = max(1, int(statement_timeout_seconds))
        self._lock_timeout_seconds = max(1, int(lock_timeout_seconds))
        self._connection_factory = connection_factory

    @classmethod
    def from_settings(cls, settings: Any) -> "TigerPICSDurableWorkStore":
        database_url = settings.pics_intake_tiger_url or settings.tiger_primary_url
        if not database_url:
            raise ValueError(
                "Durable PICS processing requires PICS_INTAKE_TIGER_URL or TIGER_PRIMARY_URL"
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
                "Durable PICS processing requires psycopg. Install pics-service dependencies."
            ) from error

        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-durable-work",
        )

    def claim_work(
        self,
        *,
        work_mode: str,
        stream_key: str,
        worker_id: str,
        lane_group: str,
        limit: int,
        lease_seconds: int,
    ) -> List[PICSWorkClaim]:
        """Recover stale leases and atomically claim a bounded lane quota."""

        normalized_mode, normalized_stream, normalized_worker = self._validate_identity(
            work_mode=work_mode,
            stream_key=stream_key,
            worker_id=worker_id,
        )
        lanes = self._VALID_LANE_GROUPS.get(lane_group.strip().lower())
        if lanes is None:
            raise ValueError("lane_group must be live or catchup")
        bounded_limit = max(0, min(int(limit), 500))
        if bounded_limit == 0:
            return []
        bounded_lease_seconds = max(30, min(int(lease_seconds), 3600))

        try:
            from psycopg.rows import dict_row
        except ImportError:
            dict_row = None

        with self._connect() as connection:
            with connection.transaction():
                cursor_kwargs = {"row_factory": dict_row} if dict_row is not None else {}
                with connection.cursor(**cursor_kwargs) as cursor:
                    self._configure_transaction(cursor)
                    self._recover_stale_claims(
                        cursor,
                        work_mode=normalized_mode,
                        stream_key=normalized_stream,
                    )
                    cursor.execute(
                        """
                        WITH candidates AS (
                          SELECT work.id
                          FROM ops.pics_work_state work
                          WHERE work.work_mode = %s
                            AND work.stream_key = %s
                            AND work.lane = ANY(%s::text[])
                            AND work.state IN ('pending', 'retrying')
                            AND work.next_attempt_at <= clock_timestamp()
                            AND work.attempts < work.max_attempts
                            AND (
                              work.reconciliation_run_id IS NULL
                              OR EXISTS (
                                SELECT 1
                                FROM ops.pics_reconciliation_runs reconciliation
                                WHERE reconciliation.id = work.reconciliation_run_id
                                  AND reconciliation.status = 'active'
                              )
                            )
                          ORDER BY
                            CASE work.lane
                              WHEN 'new' THEN 0
                              WHEN 'live' THEN 1
                              ELSE 2
                            END,
                            work.priority DESC,
                            CASE work.state
                              WHEN 'retrying' THEN 0
                              ELSE 1
                            END,
                            work.next_attempt_at ASC,
                            work.dirty_since ASC,
                            work.id ASC
                          FOR UPDATE OF work SKIP LOCKED
                          LIMIT %s
                        )
                        UPDATE ops.pics_work_state work
                        SET state = 'claimed',
                            claimed_through_change_number = work.latest_change_number,
                            claimed_needs_token = work.needs_token,
                            claimed_at = clock_timestamp(),
                            claim_expires_at = clock_timestamp()
                              + make_interval(secs => %s),
                            heartbeat_at = clock_timestamp(),
                            worker_id = %s,
                            attempts = work.attempts + 1,
                            last_error_code = NULL,
                            last_error_message = NULL,
                            dead_lettered_at = NULL,
                            updated_at = clock_timestamp()
                        FROM candidates
                        WHERE work.id = candidates.id
                        RETURNING
                          work.id,
                          work.appid,
                          work.stream_key,
                          work.work_mode,
                          work.lane,
                          work.priority,
                          work.claimed_through_change_number,
                          work.attempts,
                          work.max_attempts,
                          work.claim_expires_at,
                          work.worker_id,
                          work.claimed_needs_token,
                          work.reconciliation_run_id
                        """,
                        (
                            normalized_mode,
                            normalized_stream,
                            list(lanes),
                            bounded_limit,
                            bounded_lease_seconds,
                            normalized_worker,
                        ),
                    )
                    rows = cursor.fetchall()

        return [self._claim_from_row(row) for row in rows]

    def heartbeat_claims(
        self,
        *,
        claims: Sequence[PICSWorkClaim],
        worker_id: str,
        lease_seconds: int,
    ) -> int:
        """Extend live leases owned by one worker; expired claims stay expired."""

        if not claims:
            return 0
        normalized_worker = self._normalize_worker(worker_id)
        claim_ids = [int(claim.id) for claim in claims]
        bounded_lease_seconds = max(30, min(int(lease_seconds), 3600))

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    cursor.execute(
                        """
                        UPDATE ops.pics_work_state
                        SET heartbeat_at = clock_timestamp(),
                            claim_expires_at = clock_timestamp()
                              + make_interval(secs => %s),
                            updated_at = clock_timestamp()
                        WHERE id = ANY(%s::bigint[])
                          AND state = 'claimed'
                          AND worker_id = %s
                          AND claim_expires_at > clock_timestamp()
                        """,
                        (bounded_lease_seconds, claim_ids, normalized_worker),
                    )
                    return int(cursor.rowcount)

    def fail_claim(
        self,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
        error_code: str,
        error_message: str,
        retryable: bool,
        retry_delay_seconds: int,
    ) -> str:
        """Release a failed claim to retry or dead-letter it."""

        normalized_worker = self._normalize_worker(worker_id)
        normalized_code = self._bounded_text(error_code, 120, "processing_error")
        normalized_message = self._bounded_text(error_message, 2000, normalized_code)
        bounded_delay = max(1, min(int(retry_delay_seconds), 86400))

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    row = self._lock_claim(
                        cursor,
                        claim=claim,
                        worker_id=normalized_worker,
                    )
                    attempts = int(row[0])
                    max_attempts = int(row[1])
                    should_retry = bool(retryable) and attempts < max_attempts
                    next_state = "retrying" if should_retry else "dead_letter"
                    cursor.execute(
                        """
                        UPDATE ops.pics_work_state
                        SET state = %s,
                            claimed_through_change_number = NULL,
                            claimed_needs_token = NULL,
                            claimed_at = NULL,
                            claim_expires_at = NULL,
                            heartbeat_at = NULL,
                            worker_id = NULL,
                            next_attempt_at = CASE
                              WHEN %s THEN clock_timestamp()
                                + make_interval(secs => %s)
                              ELSE next_attempt_at
                            END,
                            last_error_code = %s,
                            last_error_message = %s,
                            dead_lettered_at = CASE
                              WHEN %s THEN NULL
                              ELSE clock_timestamp()
                            END,
                            updated_at = clock_timestamp()
                        WHERE id = %s
                        """,
                        (
                            next_state,
                            should_retry,
                            bounded_delay,
                            normalized_code,
                            normalized_message,
                            should_retry,
                            claim.id,
                        ),
                    )
                    if not should_retry and claim.work_mode == "durable":
                        readiness_provenance = {
                            "workId": claim.id,
                            "streamKey": claim.stream_key,
                            "claimedThroughChangeNumber": (claim.claimed_through_change_number),
                            "attempts": attempts,
                            "maxAttempts": max_attempts,
                        }
                        if claim.reconciliation_run_id is not None:
                            readiness_provenance["reconciliationRunId"] = str(
                                claim.reconciliation_run_id
                            )
                        self._upsert_readiness(
                            cursor,
                            appid=claim.appid,
                            status="failed",
                            blocking_reason=normalized_code,
                            retryable=False,
                            provenance=readiness_provenance,
                        )
                    self._settle_reconciliation_failure(
                        cursor,
                        claim=claim,
                        next_state=next_state,
                        error_code=normalized_code,
                        error_message=normalized_message,
                    )
                    return next_state

    def block_claim(
        self,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
        blocking_reason: str,
        detail: str,
        provenance: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Record a terminal source limitation without treating it as processed."""

        normalized_worker = self._normalize_worker(worker_id)
        normalized_reason = self._bounded_text(blocking_reason, 120, "source_blocked")
        normalized_detail = self._bounded_text(detail, 2000, normalized_reason)
        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    self._lock_claim(cursor, claim=claim, worker_id=normalized_worker)
                    cursor.execute(
                        """
                        UPDATE ops.pics_work_state
                        SET state = 'source_blocked',
                            claimed_through_change_number = NULL,
                            claimed_needs_token = NULL,
                            claimed_at = NULL,
                            claim_expires_at = NULL,
                            heartbeat_at = NULL,
                            worker_id = NULL,
                            last_error_code = %s,
                            last_error_message = %s,
                            dead_lettered_at = NULL,
                            updated_at = clock_timestamp()
                        WHERE id = %s
                        """,
                        (normalized_reason, normalized_detail, claim.id),
                    )
                    if claim.work_mode == "durable":
                        readiness_provenance = {
                            "workId": claim.id,
                            "streamKey": claim.stream_key,
                            "claimedThroughChangeNumber": (claim.claimed_through_change_number),
                            **(provenance or {}),
                        }
                        self._upsert_readiness(
                            cursor,
                            appid=claim.appid,
                            status="source_blocked",
                            blocking_reason=normalized_reason,
                            retryable=False,
                            provenance=readiness_provenance,
                        )
                    self._settle_reconciliation_source_block(
                        cursor,
                        claim=claim,
                        blocking_reason=normalized_reason,
                        detail=normalized_detail,
                        provenance=provenance,
                    )

    def complete_shadow_claim(
        self,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
    ) -> str:
        """Acknowledge validated shadow work without changing primary state."""

        normalized_worker = self._normalize_worker(worker_id)
        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    self._lock_claim(cursor, claim=claim, worker_id=normalized_worker)
                    return self.complete_locked_claim(cursor, claim=claim)

    def get_latest_snapshot(self, appid: int) -> Optional[PICSLatestSnapshot]:
        """Return the latest PICS snapshot pointer for one bounded app."""

        return self.get_latest_snapshots([appid]).get(int(appid))

    def get_latest_snapshots(
        self,
        appids: Sequence[int],
    ) -> Dict[int, PICSLatestSnapshot]:
        """Return latest PICS snapshot pointers in one bounded transaction."""

        normalized_appids = sorted({int(appid) for appid in appids if int(appid) > 0})
        if not normalized_appids:
            return {}
        if len(normalized_appids) > 500:
            raise ValueError("At most 500 latest PICS snapshot pointers may be read")

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    cursor.execute(
                        """
                        SELECT DISTINCT ON (appid)
                          appid,
                          id,
                          content_hash,
                          archive_bucket,
                          archive_key,
                          archive_content_hash
                        FROM docs.app_source_snapshots
                        WHERE source = 'pics'
                          AND appid = ANY(%s::integer[])
                          AND archive_bucket IS NOT NULL
                          AND archive_key IS NOT NULL
                          AND archive_content_hash IS NOT NULL
                        ORDER BY appid, first_seen_at DESC, id DESC
                        LIMIT 500
                        """,
                        (normalized_appids,),
                    )
                    rows = cursor.fetchall()
        return {
            int(row[0]): PICSLatestSnapshot(
                id=int(row[1]),
                content_hash=str(row[2]),
                archive_bucket=str(row[3]),
                archive_key=str(row[4]),
                archive_content_hash=str(row[5]),
            )
            for row in rows
        }

    def get_queue_metrics(
        self,
        *,
        work_mode: str,
        stream_key: str,
    ) -> PICSQueueMetrics:
        """Return one bounded operational snapshot without changing work."""

        normalized_mode, normalized_stream, _worker = self._validate_identity(
            work_mode=work_mode,
            stream_key=stream_key,
            worker_id="queue-metrics",
        )
        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    cursor.execute(
                        """
                        SELECT
                          clock_timestamp(),
                          count(*) FILTER (
                            WHERE lane IN ('new', 'live')
                              AND state IN ('pending', 'retrying', 'claimed')
                          ),
                          count(*) FILTER (
                            WHERE lane = 'catchup'
                              AND state IN ('pending', 'retrying', 'claimed')
                          ),
                          count(*) FILTER (WHERE state = 'retrying'),
                          count(*) FILTER (WHERE state = 'claimed'),
                          count(*) FILTER (WHERE state = 'dead_letter'),
                          count(*) FILTER (
                            WHERE state = 'source_blocked'
                              AND last_error_code = 'missing_access_token'
                          ),
                          count(*) FILTER (
                            WHERE lane = 'catchup'
                              AND (
                                last_completed_at >= clock_timestamp() - interval '1 hour'
                                OR (
                                  state = 'source_blocked'
                                  AND updated_at >= clock_timestamp() - interval '1 hour'
                                )
                                OR dead_lettered_at
                                  >= clock_timestamp() - interval '1 hour'
                              )
                          )
                        FROM ops.pics_work_state
                        WHERE work_mode = %s
                          AND stream_key = %s
                        LIMIT 1
                        """,
                        (normalized_mode, normalized_stream),
                    )
                    row = cursor.fetchone()
        if row is None:
            raise RuntimeError("PICS queue metrics query returned no row")
        catchup_open = int(row[2])
        catchup_settled_last_hour = int(row[7])
        settlements_per_minute = catchup_settled_last_hour / 60.0
        eta_hours = (
            catchup_open / catchup_settled_last_hour if catchup_settled_last_hour > 0 else None
        )
        return PICSQueueMetrics(
            observed_at=row[0],
            live_open=int(row[1]),
            catchup_open=catchup_open,
            retrying=int(row[3]),
            claimed=int(row[4]),
            dead_letter=int(row[5]),
            missing_access_token=int(row[6]),
            catchup_settled_last_hour=catchup_settled_last_hour,
            catchup_settlements_per_minute=settlements_per_minute,
            catchup_eta_hours=eta_hours,
        )

    def preview_missing_access_token_replay(
        self,
        *,
        appids: Sequence[int] = (),
        limit: int = 100,
    ) -> List[PICSTokenReplayCandidate]:
        """Report bounded token blocks and Storefront fallback coverage."""

        normalized_appids = sorted({int(appid) for appid in appids if int(appid) > 0})
        if len(normalized_appids) > 100:
            raise ValueError("At most 100 exact appids may be previewed")
        bounded_limit = max(1, min(int(limit), 500))
        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
                    self._configure_transaction(cursor)
                    cursor.execute(
                        """
                        SELECT
                          work.id,
                          work.appid,
                          work.stream_key,
                          work.lane,
                          work.latest_change_number,
                          work.needs_token,
                          work.updated_at,
                          readiness.status,
                          readiness.source_at,
                          COALESCE(fields.coverage, '{}'::jsonb),
                          COALESCE(snapshot.snapshot_summary, '{}'::jsonb)
                        FROM ops.pics_work_state work
                        LEFT JOIN ops.app_data_readiness readiness
                          ON readiness.appid = work.appid
                         AND readiness.source = 'storefront'
                        LEFT JOIN LATERAL (
                          SELECT jsonb_object_agg(
                            evidence.field_name,
                            evidence.evidence_state
                            ORDER BY evidence.field_name
                          ) AS coverage
                          FROM ops.app_field_evidence evidence
                          WHERE evidence.appid = work.appid
                            AND evidence.source = 'storefront'
                            AND evidence.field_name = ANY(
                              ARRAY['genres','categories','platforms','languages']::text[]
                            )
                        ) fields ON true
                        LEFT JOIN LATERAL (
                          SELECT source_snapshot.snapshot_summary
                          FROM docs.app_source_snapshots source_snapshot
                          WHERE source_snapshot.appid = work.appid
                            AND source_snapshot.source = 'storefront'
                          ORDER BY source_snapshot.observed_at DESC, source_snapshot.id DESC
                          LIMIT 1
                        ) snapshot ON true
                        WHERE work.state = 'source_blocked'
                          AND work.work_mode = 'durable'
                          AND work.stream_key = 'primary'
                          AND work.last_error_code = 'missing_access_token'
                          AND work.needs_token = true
                          AND (
                            cardinality(%s::integer[]) = 0
                            OR work.appid = ANY(%s::integer[])
                          )
                        ORDER BY work.updated_at ASC, work.appid ASC
                        LIMIT %s
                        """,
                        (normalized_appids, normalized_appids, bounded_limit),
                    )
                    rows = cursor.fetchall()
        return [
            PICSTokenReplayCandidate(
                work_id=int(row[0]),
                appid=int(row[1]),
                stream_key=str(row[2]),
                lane=str(row[3]),
                latest_change_number=int(row[4]),
                needs_token=bool(row[5]),
                blocked_at=row[6],
                storefront_status=str(row[7]) if row[7] is not None else None,
                storefront_source_at=row[8],
                storefront_field_coverage=dict(row[9] or {}),
                storefront_snapshot_summary=dict(row[10] or {}),
            )
            for row in rows
        ]

    def requeue_missing_access_token(
        self,
        *,
        appids: Sequence[int],
        requested_by: str,
        reason: str,
        archive: Dict[str, str],
    ) -> int:
        """Reopen exact audited token blocks after an operator-approved replay."""

        normalized_appids = sorted({int(appid) for appid in appids if int(appid) > 0})
        if not normalized_appids or len(normalized_appids) > 100:
            raise ValueError("Replay requires between 1 and 100 exact appids")
        normalized_requested_by = self._bounded_text(requested_by, 200, "unknown_operator")
        normalized_reason = self._bounded_text(reason, 500, "token_replay")
        required_archive = ("bucket", "key", "content_hash")
        if any(not str(archive.get(key, "")).strip() for key in required_archive):
            raise ValueError("Replay requires an immutable archive pointer")

        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    self._configure_transaction(cursor)
                    cursor.execute(
                        """
                        SELECT id, appid, state, last_error_code
                        FROM ops.pics_work_state
                        WHERE appid = ANY(%s::integer[])
                          AND work_mode = 'durable'
                          AND stream_key = 'primary'
                          AND state = 'source_blocked'
                          AND last_error_code = 'missing_access_token'
                          AND needs_token = true
                        ORDER BY appid
                        FOR UPDATE
                        """,
                        (normalized_appids,),
                    )
                    rows = cursor.fetchall()
                    found = {int(row[1]) for row in rows}
                    if found != set(normalized_appids):
                        missing = sorted(set(normalized_appids) - found)
                        raise PICSWorkStateError(
                            f"Token replay targets are no longer eligible: {missing}"
                        )
                    for row in rows:
                        cursor.execute(
                            """
                            INSERT INTO ops.pics_token_replay_audit (
                              appid,
                              work_id,
                              prior_state,
                              prior_error_code,
                              requested_by,
                              reason,
                              archive_bucket,
                              archive_key,
                              archive_content_hash
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            """,
                            (
                                int(row[1]),
                                int(row[0]),
                                str(row[2]),
                                str(row[3]),
                                normalized_requested_by,
                                normalized_reason,
                                archive["bucket"],
                                archive["key"],
                                archive["content_hash"],
                            ),
                        )
                    cursor.execute(
                        """
                        UPDATE ops.pics_work_state
                        SET state = 'pending',
                            attempts = 0,
                            next_attempt_at = clock_timestamp(),
                            claimed_through_change_number = NULL,
                            claimed_needs_token = NULL,
                            claimed_at = NULL,
                            claim_expires_at = NULL,
                            heartbeat_at = NULL,
                            worker_id = NULL,
                            last_error_code = NULL,
                            last_error_message = NULL,
                            dead_lettered_at = NULL,
                            updated_at = clock_timestamp()
                        WHERE appid = ANY(%s::integer[])
                          AND work_mode = 'durable'
                          AND stream_key = 'primary'
                          AND state = 'source_blocked'
                          AND last_error_code = 'missing_access_token'
                          AND needs_token = true
                        """,
                        (normalized_appids,),
                    )
                    requeued = int(cursor.rowcount)
                    cursor.execute(
                        """
                        UPDATE ops.app_data_readiness
                        SET status = 'pending',
                            processed_at = NULL,
                            blocking_reason = 'awaiting_token_replay',
                            retryable = true,
                            provenance = jsonb_build_object(
                              'requestedBy', %s::text,
                              'reason', %s::text,
                              'archive', jsonb_build_object(
                                'bucket', %s::text,
                                'key', %s::text,
                                'contentHash', %s::text
                              )
                            ),
                            updated_at = clock_timestamp()
                        WHERE appid = ANY(%s::integer[])
                          AND source = 'pics'
                        """,
                        (
                            normalized_requested_by,
                            normalized_reason,
                            archive["bucket"],
                            archive["key"],
                            archive["content_hash"],
                            normalized_appids,
                        ),
                    )
        return requeued

    @classmethod
    def complete_locked_claim(
        cls,
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        snapshot_id: Optional[int] = None,
        source_change_number: Optional[int] = None,
    ) -> str:
        """Settle a claim inside the caller's promotion transaction."""

        cursor.execute(
            """
            UPDATE ops.pics_work_state
            SET state = CASE
                  WHEN latest_change_number > %s THEN 'pending'
                  ELSE 'completed'
                END,
                last_completed_change_number = greatest(
                  coalesce(last_completed_change_number, 0),
                  %s
                ),
                last_completed_at = clock_timestamp(),
                dirty_since = CASE
                  WHEN latest_change_number > %s THEN last_dirty_at
                  ELSE dirty_since
                END,
                claimed_through_change_number = NULL,
                claimed_needs_token = NULL,
                claimed_at = NULL,
                claim_expires_at = NULL,
                heartbeat_at = NULL,
                worker_id = NULL,
                attempts = 0,
                next_attempt_at = CASE
                  WHEN latest_change_number > %s THEN clock_timestamp()
                  ELSE next_attempt_at
                END,
                last_error_code = NULL,
                last_error_message = NULL,
                dead_lettered_at = NULL,
                updated_at = clock_timestamp()
            WHERE id = %s
            RETURNING state
            """,
            (
                claim.claimed_through_change_number,
                claim.claimed_through_change_number,
                claim.claimed_through_change_number,
                claim.claimed_through_change_number,
                claim.id,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise PICSWorkStateError(f"PICS work {claim.id} disappeared during completion")
        cls._settle_reconciliation_completion(
            cursor,
            claim=claim,
            snapshot_id=snapshot_id,
            source_change_number=source_change_number,
        )
        return str(row[0])

    def lock_claim_for_promotion(
        self,
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
    ) -> None:
        """Verify claim ownership inside another store's transaction."""

        self._lock_claim(
            cursor,
            claim=claim,
            worker_id=self._normalize_worker(worker_id),
        )

    def configure_transaction(self, cursor: Any) -> None:
        self._configure_transaction(cursor)

    def upsert_ready_state(
        self,
        cursor: Any,
        *,
        appid: int,
        provenance: Dict[str, Any],
        source_at: Optional[datetime],
    ) -> None:
        self._upsert_readiness(
            cursor,
            appid=appid,
            status="ready",
            blocking_reason=None,
            retryable=True,
            provenance=provenance,
            source_at=source_at,
        )

    def _recover_stale_claims(
        self,
        cursor: Any,
        *,
        work_mode: str,
        stream_key: str,
    ) -> None:
        cursor.execute(
            """
            UPDATE ops.pics_work_state
            SET state = CASE
                  WHEN attempts >= max_attempts THEN 'dead_letter'
                  ELSE 'retrying'
                END,
                claimed_through_change_number = NULL,
                claimed_needs_token = NULL,
                claimed_at = NULL,
                claim_expires_at = NULL,
                heartbeat_at = NULL,
                worker_id = NULL,
                next_attempt_at = clock_timestamp(),
                last_error_code = 'lease_expired',
                last_error_message = 'Worker lease expired before acknowledgement',
                dead_lettered_at = CASE
                  WHEN attempts >= max_attempts THEN clock_timestamp()
                  ELSE NULL
                END,
                updated_at = clock_timestamp()
            WHERE work_mode = %s
              AND stream_key = %s
              AND state = 'claimed'
              AND claim_expires_at <= clock_timestamp()
            """,
            (work_mode, stream_key),
        )
        cursor.execute(
            """
            UPDATE ops.pics_reconciliation_items items
            SET status = 'dead_letter',
                last_error_code = 'lease_expired',
                last_error_message = 'Worker lease expired before acknowledgement',
                disposition = jsonb_build_object(
                  'workId', work.id,
                  'reason', 'lease_expired',
                  'attempts', work.attempts,
                  'maxAttempts', work.max_attempts
                ),
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
            FROM ops.pics_work_state work
            WHERE work.reconciliation_run_id = items.run_id
              AND work.appid = items.appid
              AND work.work_mode = %s
              AND work.stream_key = %s
              AND work.state = 'dead_letter'
              AND work.last_error_code = 'lease_expired'
              AND items.status IN ('pending', 'completed')
            """,
            (work_mode, stream_key),
        )

    @staticmethod
    def _settle_reconciliation_failure(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        next_state: str,
        error_code: str,
        error_message: str,
    ) -> None:
        cursor.execute(
            """
            UPDATE ops.pics_reconciliation_items
            SET status = CASE
                  WHEN %s = 'dead_letter' THEN 'dead_letter'
                  ELSE 'pending'
                END,
                last_error_code = %s,
                last_error_message = %s,
                disposition = CASE
                  WHEN %s = 'dead_letter' THEN jsonb_build_object(
                    'workId', %s::bigint,
                    'reason', %s::text,
                    'attempts', %s::integer,
                    'maxAttempts', %s::integer
                  )
                  ELSE NULL
                END,
                completed_at = CASE
                  WHEN %s = 'dead_letter' THEN clock_timestamp()
                  ELSE NULL
                END,
                updated_at = clock_timestamp()
            WHERE work_id = %s
              AND appid = %s
              AND status IN ('pending', 'completed')
            """,
            (
                next_state,
                error_code,
                error_message,
                next_state,
                claim.id,
                error_code,
                claim.attempts,
                claim.max_attempts,
                next_state,
                claim.id,
                claim.appid,
            ),
        )
        if claim.reconciliation_run_id is not None and cursor.rowcount != 1:
            raise PICSWorkStateError(
                f"Reconciliation item for work {claim.id} disappeared during failure"
            )

    @staticmethod
    def _settle_reconciliation_source_block(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        blocking_reason: str,
        detail: str,
        provenance: Optional[Dict[str, Any]],
    ) -> None:
        cursor.execute(
            """
            UPDATE ops.pics_reconciliation_items
            SET status = 'source_blocked',
                last_error_code = %s,
                last_error_message = %s,
                disposition = %s::jsonb,
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
            WHERE work_id = %s
              AND appid = %s
              AND status IN ('pending', 'completed')
            """,
            (
                blocking_reason,
                detail,
                json.dumps(
                    {
                        "workId": claim.id,
                        "reason": blocking_reason,
                        **(provenance or {}),
                    },
                    sort_keys=True,
                    default=str,
                ),
                claim.id,
                claim.appid,
            ),
        )
        if claim.reconciliation_run_id is not None and cursor.rowcount != 1:
            raise PICSWorkStateError(
                f"Reconciliation item for work {claim.id} disappeared during source block"
            )

    @staticmethod
    def _settle_reconciliation_completion(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        snapshot_id: Optional[int],
        source_change_number: Optional[int],
    ) -> None:
        if claim.reconciliation_run_id is not None and (
            snapshot_id is None or source_change_number is None
        ):
            raise PICSWorkStateError(
                "Reconciliation completion requires snapshot and source change evidence"
            )
        if snapshot_id is None or source_change_number is None:
            return
        cursor.execute(
            """
            UPDATE ops.pics_reconciliation_items
            SET status = 'completed',
                completed_snapshot_id = %s,
                source_change_number = %s,
                last_error_code = NULL,
                last_error_message = NULL,
                disposition = jsonb_build_object(
                  'workId', %s,
                  'snapshotId', %s,
                  'sourceChangeNumber', %s
                ),
                completed_at = clock_timestamp(),
                updated_at = clock_timestamp()
            WHERE work_id = %s
              AND appid = %s
              AND status IN ('pending', 'completed')
            """,
            (
                snapshot_id,
                source_change_number,
                claim.id,
                snapshot_id,
                source_change_number,
                claim.id,
                claim.appid,
            ),
        )
        if claim.reconciliation_run_id is not None and cursor.rowcount != 1:
            raise PICSWorkStateError(
                f"Reconciliation item for work {claim.id} disappeared during completion"
            )

    @staticmethod
    def _lock_claim(
        cursor: Any,
        *,
        claim: PICSWorkClaim,
        worker_id: str,
    ) -> Any:
        cursor.execute(
            """
            SELECT attempts, max_attempts
            FROM ops.pics_work_state
            WHERE id = %s
              AND appid = %s
              AND stream_key = %s
              AND work_mode = %s
              AND state = 'claimed'
              AND worker_id = %s
              AND claimed_through_change_number = %s
              AND claimed_needs_token = %s
              AND claim_expires_at > clock_timestamp()
            FOR UPDATE
            """,
            (
                claim.id,
                claim.appid,
                claim.stream_key,
                claim.work_mode,
                worker_id,
                claim.claimed_through_change_number,
                claim.needs_token,
            ),
        )
        row = cursor.fetchone()
        if row is None:
            raise PICSWorkStateError(
                f"PICS work {claim.id} is no longer owned by worker {worker_id}"
            )
        return row

    @staticmethod
    def _upsert_readiness(
        cursor: Any,
        *,
        appid: int,
        status: str,
        blocking_reason: Optional[str],
        retryable: bool,
        provenance: Dict[str, Any],
        source_at: Optional[datetime] = None,
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
            VALUES (
              %s,
              'pics',
              %s,
              %s,
              CASE WHEN %s = 'ready' THEN clock_timestamp() ELSE NULL END,
              'pics-readiness/v1',
              %s,
              %s,
              %s::jsonb,
              clock_timestamp(),
              clock_timestamp()
            )
            ON CONFLICT (appid, source)
            DO UPDATE SET
              status = EXCLUDED.status,
              source_at = EXCLUDED.source_at,
              processed_at = EXCLUDED.processed_at,
              version = EXCLUDED.version,
              blocking_reason = EXCLUDED.blocking_reason,
              retryable = EXCLUDED.retryable,
              provenance = EXCLUDED.provenance,
              updated_at = clock_timestamp()
            """,
            (
                int(appid),
                status,
                source_at,
                status,
                blocking_reason,
                bool(retryable),
                json.dumps(provenance, sort_keys=True, default=str),
            ),
        )

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
    def _claim_from_row(row: Any) -> PICSWorkClaim:
        if isinstance(row, dict):
            values = row
        else:
            keys = (
                "id",
                "appid",
                "stream_key",
                "work_mode",
                "lane",
                "priority",
                "claimed_through_change_number",
                "attempts",
                "max_attempts",
                "claim_expires_at",
                "worker_id",
                "claimed_needs_token",
                "reconciliation_run_id",
            )
            values = dict(zip(keys, row))
        return PICSWorkClaim(
            id=int(values["id"]),
            appid=int(values["appid"]),
            stream_key=str(values["stream_key"]),
            work_mode=str(values["work_mode"]),
            lane=str(values["lane"]),
            priority=int(values["priority"]),
            claimed_through_change_number=int(values["claimed_through_change_number"]),
            attempts=int(values["attempts"]),
            max_attempts=int(values["max_attempts"]),
            claim_expires_at=values["claim_expires_at"],
            worker_id=str(values["worker_id"]),
            needs_token=bool(values["claimed_needs_token"]),
            reconciliation_run_id=(
                UUID(str(values["reconciliation_run_id"]))
                if values.get("reconciliation_run_id") is not None
                else None
            ),
        )

    def _validate_identity(
        self,
        *,
        work_mode: str,
        stream_key: str,
        worker_id: str,
    ) -> tuple[str, str, str]:
        normalized_mode = work_mode.strip().lower()
        if normalized_mode not in self._VALID_WORK_MODES:
            raise ValueError("work_mode must be shadow or durable")
        normalized_stream = stream_key.strip()
        if not normalized_stream or len(normalized_stream) > 128:
            raise ValueError("stream_key must contain 1 to 128 characters")
        if normalized_mode == "durable" and normalized_stream != "primary":
            raise ValueError("durable work must use the primary stream")
        if normalized_mode == "shadow" and normalized_stream == "primary":
            raise ValueError("shadow work cannot use the primary stream")
        return normalized_mode, normalized_stream, self._normalize_worker(worker_id)

    @staticmethod
    def _normalize_worker(worker_id: str) -> str:
        normalized = worker_id.strip()
        if not normalized or len(normalized) > 200:
            raise ValueError("worker_id must contain 1 to 200 characters")
        return normalized

    @staticmethod
    def _bounded_text(value: str, limit: int, fallback: str) -> str:
        normalized = (value or "").strip() or fallback
        return normalized[:limit]
