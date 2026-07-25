"""Fail-closed planning and execution for replaying shadow PICS batches."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any, Callable, Mapping, Optional, Sequence
from uuid import UUID

from .durable_intake import (
    PICSArchiveReference,
    PICSBatchReconciliationError,
    PICSCursorMismatchError,
    PICSDurableIntakeError,
    PICSReplayProvenance,
    PICSSourceAppChange,
    TigerPICSDurableIntakeStore,
    hash_pics_app_changes,
)
from .tiger_change_history import S3ArchiveStore

PLAN_SCHEMA_VERSION = "pics-shadow-gap-replay-plan/v1"
ARCHIVE_PROVENANCE_VERSION = "pics-shadow-gap-replay-provenance/v1"


@dataclass(frozen=True)
class PICSForceFullGapEvidence:
    """One archived primary force-full response that blocked intake."""

    batch_id: UUID
    from_change_number: int
    to_change_number: int
    response_since_change_number: int
    force_full_update: bool
    force_full_app_update: bool
    source_complete: bool
    status: str
    primary_cursor_advanced: bool
    archive: PICSArchiveReference


@dataclass(frozen=True)
class PICSShadowSourceBatch:
    """One complete archived shadow response and its durable child manifest."""

    batch_id: UUID
    stream_key: str
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
    archive: PICSArchiveReference
    received_at: datetime
    changes: tuple[PICSSourceAppChange, ...]


@dataclass(frozen=True)
class PICSShadowGapReplayStep:
    """One primary cursor transaction derived from one shadow response."""

    sequence_number: int
    source_batch: PICSShadowSourceBatch
    from_change_number: int
    to_change_number: int
    app_changes: tuple[PICSSourceAppChange, ...]
    app_changes_sha256: str

    @property
    def source_app_count(self) -> int:
        return len(self.app_changes)

    @property
    def distinct_app_count(self) -> int:
        return len({change.appid for change in self.app_changes})


@dataclass(frozen=True)
class PICSShadowGapReplayPlan:
    """Immutable reviewed replay plan that can resume on a step boundary."""

    gap_evidence: PICSForceFullGapEvidence
    source_stream_key: str
    expected_start_change_number: int
    target_change_number: int
    current_change_number: int
    requested_by: str
    steps: tuple[PICSShadowGapReplayStep, ...]
    completed_steps: int
    plan_sha256: str

    @property
    def pending_steps(self) -> tuple[PICSShadowGapReplayStep, ...]:
        return self.steps[self.completed_steps :]

    @property
    def source_app_count(self) -> int:
        return sum(step.source_app_count for step in self.steps)


@dataclass(frozen=True)
class PICSShadowGapReplayResult:
    """Execution result for one reviewed replay plan."""

    plan_sha256: str
    start_change_number: int
    target_change_number: int
    previously_completed_steps: int
    newly_committed_batch_ids: tuple[UUID, ...]


def assemble_shadow_gap_replay_plan(
    *,
    gap_evidence: PICSForceFullGapEvidence,
    source_stream_key: str,
    first_source_batch_id: UUID,
    expected_start_change_number: int,
    target_change_number: int,
    current_change_number: int,
    requested_by: str,
    source_batches: Sequence[PICSShadowSourceBatch],
    completed_provenance: Sequence[Mapping[str, Any]] = (),
) -> PICSShadowGapReplayPlan:
    """Build and hash one exact shadow chain without mutating Tiger or R2."""

    normalized_stream = source_stream_key.strip()
    normalized_requested_by = requested_by.strip()
    expected_start = int(expected_start_change_number)
    target = int(target_change_number)
    current = int(current_change_number)
    if not normalized_stream or normalized_stream == "primary":
        raise ValueError("Replay source stream must be a non-primary stream")
    if len(normalized_stream) > 128:
        raise ValueError("Replay source stream must be 128 characters or fewer")
    if not normalized_requested_by or len(normalized_requested_by) > 200:
        raise ValueError("Replay requested_by must contain 1-200 characters")
    if expected_start < 0 or target <= expected_start:
        raise ValueError("Replay target must be greater than its nonnegative start cursor")
    if current < expected_start or current > target:
        raise PICSCursorMismatchError(
            f"Primary cursor {current} is outside replay range ({expected_start}, {target}]"
        )
    _validate_gap_evidence(gap_evidence, expected_start=expected_start)

    by_id = {batch.batch_id: batch for batch in source_batches}
    first_batch = by_id.get(UUID(str(first_source_batch_id)))
    if first_batch is None:
        raise PICSBatchReconciliationError("Explicit first shadow source batch is missing")

    steps: list[PICSShadowGapReplayStep] = []
    boundary = expected_start
    source_batch = first_batch
    used_batch_ids: set[UUID] = set()
    while boundary < target:
        if source_batch.batch_id in used_batch_ids:
            raise PICSBatchReconciliationError("Shadow replay chain contains a cycle")
        used_batch_ids.add(source_batch.batch_id)
        _validate_shadow_batch(source_batch, expected_stream=normalized_stream)
        if not (source_batch.from_change_number <= boundary < source_batch.to_change_number):
            raise PICSBatchReconciliationError(
                "Shadow replay batch does not cover the next primary cursor boundary"
            )
        if source_batch.to_change_number > target:
            raise PICSBatchReconciliationError(
                "Shadow replay target must end at an exact source batch boundary"
            )

        recovered_changes = tuple(
            change for change in source_batch.changes if change.change_number > boundary
        )
        for change in recovered_changes:
            if change.change_number > source_batch.to_change_number:
                raise PICSBatchReconciliationError(
                    "Shadow replay suffix contains an app change after its source cursor"
                )
        steps.append(
            PICSShadowGapReplayStep(
                sequence_number=len(steps),
                source_batch=source_batch,
                from_change_number=boundary,
                to_change_number=source_batch.to_change_number,
                app_changes=recovered_changes,
                app_changes_sha256=hash_pics_app_changes(recovered_changes),
            )
        )
        boundary = source_batch.to_change_number
        if boundary == target:
            break

        candidates = [
            batch
            for batch in source_batches
            if batch.batch_id not in used_batch_ids
            and batch.from_change_number == boundary
            and batch.to_change_number <= target
        ]
        if len(candidates) != 1:
            raise PICSBatchReconciliationError(
                "Shadow replay chain is missing or ambiguous at "
                f"change number {boundary}: found {len(candidates)} candidates"
            )
        source_batch = candidates[0]

    plan_sha256 = _hash_plan(
        gap_evidence=gap_evidence,
        source_stream_key=normalized_stream,
        expected_start_change_number=expected_start,
        target_change_number=target,
        requested_by=normalized_requested_by,
        steps=steps,
    )
    completed_steps = _validate_completed_prefix(
        steps=steps,
        current_change_number=current,
        gap_evidence_batch_id=gap_evidence.batch_id,
        source_stream_key=normalized_stream,
        requested_by=normalized_requested_by,
        plan_sha256=plan_sha256,
        completed_provenance=completed_provenance,
    )
    return PICSShadowGapReplayPlan(
        gap_evidence=gap_evidence,
        source_stream_key=normalized_stream,
        expected_start_change_number=expected_start,
        target_change_number=target,
        current_change_number=current,
        requested_by=normalized_requested_by,
        steps=tuple(steps),
        completed_steps=completed_steps,
        plan_sha256=plan_sha256,
    )


class TigerPICSShadowGapReplayPlanner:
    """Read-only Tiger planner for one explicitly bounded replay."""

    def __init__(
        self,
        database_url: str,
        *,
        statement_timeout_seconds: int = 60,
        connection_factory: Optional[Callable[[], Any]] = None,
    ):
        if not database_url and connection_factory is None:
            raise ValueError("A Tiger database URL is required for replay planning")
        self._database_url = database_url
        self._statement_timeout_seconds = max(1, int(statement_timeout_seconds))
        self._connection_factory = connection_factory

    def _connect(self) -> Any:
        if self._connection_factory is not None:
            return self._connection_factory()
        try:
            import psycopg
        except ImportError as error:
            raise RuntimeError("PICS replay planning requires psycopg") from error
        return psycopg.connect(
            self._database_url,
            application_name="publisheriq-pics-shadow-gap-replay-plan",
        )

    def build_plan(
        self,
        *,
        gap_evidence_batch_id: UUID,
        source_stream_key: str,
        first_source_batch_id: UUID,
        expected_start_change_number: int,
        target_change_number: int,
        requested_by: str,
        max_batches: int = 1000,
    ) -> PICSShadowGapReplayPlan:
        """Read a bounded source chain and return a deterministic dry-run plan."""

        if max_batches < 1 or max_batches > 5000:
            raise ValueError("Replay max_batches must be between 1 and 5000")
        with self._connect() as connection:
            with connection.transaction():
                with connection.cursor() as cursor:
                    cursor.execute("SET TRANSACTION READ ONLY")
                    cursor.execute(
                        "SELECT set_config('statement_timeout', %s, true)",
                        (f"{self._statement_timeout_seconds}s",),
                    )
                    current_change_number = self._read_primary_cursor(cursor)
                    gap = self._read_gap(cursor, UUID(str(gap_evidence_batch_id)))
                    first = self._read_source_batch_metadata(
                        cursor,
                        UUID(str(first_source_batch_id)),
                    )
                    metadata = [first]
                    cursor.execute(
                        """
                        SELECT
                          id,
                          stream_key,
                          lane,
                          from_change_number,
                          to_change_number,
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
                          archive_bucket,
                          archive_key,
                          archive_content_hash,
                          archive_byte_size,
                          archive_content_type,
                          received_at
                        FROM ops.pics_change_batches
                        WHERE stream_key = %s
                          AND work_mode = 'shadow'
                          AND from_change_number >= %s
                          AND from_change_number < %s
                          AND to_change_number <= %s
                        ORDER BY from_change_number, to_change_number, id
                        LIMIT %s
                        """,
                        (
                            source_stream_key.strip(),
                            first.to_change_number,
                            int(target_change_number),
                            int(target_change_number),
                            max_batches,
                        ),
                    )
                    candidate_rows = cursor.fetchall()
                    if len(candidate_rows) >= max_batches:
                        raise PICSBatchReconciliationError(
                            "Shadow replay exceeds the explicit batch bound"
                        )
                    metadata.extend(self._source_batch_from_row(row) for row in candidate_rows)
                    batch_ids = [batch.batch_id for batch in metadata]
                    changes_by_batch = self._read_changes(cursor, batch_ids)
                    source_batches = [
                        self._with_changes(batch, changes_by_batch.get(batch.batch_id, ()))
                        for batch in metadata
                    ]
                    completed = self._read_completed_provenance(
                        cursor,
                        gap_evidence_batch_id=UUID(str(gap_evidence_batch_id)),
                    )
                    return assemble_shadow_gap_replay_plan(
                        gap_evidence=gap,
                        source_stream_key=source_stream_key,
                        first_source_batch_id=first_source_batch_id,
                        expected_start_change_number=expected_start_change_number,
                        target_change_number=target_change_number,
                        current_change_number=current_change_number,
                        requested_by=requested_by,
                        source_batches=source_batches,
                        completed_provenance=completed,
                    )

    @staticmethod
    def _read_primary_cursor(cursor: Any) -> int:
        cursor.execute("SELECT last_change_number FROM ops.pics_sync_state WHERE id = 1")
        row = cursor.fetchone()
        if row is None:
            raise PICSDurableIntakeError("ops.pics_sync_state row id=1 is missing")
        return int(row[0])

    @staticmethod
    def _read_gap(cursor: Any, batch_id: UUID) -> PICSForceFullGapEvidence:
        cursor.execute(
            """
            SELECT
              id,
              stream_key,
              work_mode,
              from_change_number,
              to_change_number,
              response_since_change_number,
              force_full_update,
              force_full_app_update,
              source_complete,
              status,
              primary_cursor_advanced,
              archive_bucket,
              archive_key,
              archive_content_hash,
              archive_byte_size,
              archive_content_type
            FROM ops.pics_change_batches
            WHERE id = %s
            """,
            (batch_id,),
        )
        row = cursor.fetchone()
        if row is None or str(row[1]) != "primary" or str(row[2]) != "durable":
            raise PICSBatchReconciliationError(
                "Explicit replay gap evidence is not a durable primary batch"
            )
        return PICSForceFullGapEvidence(
            batch_id=UUID(str(row[0])),
            from_change_number=int(row[3]),
            to_change_number=int(row[4]),
            response_since_change_number=int(row[5]),
            force_full_update=bool(row[6]),
            force_full_app_update=bool(row[7]),
            source_complete=bool(row[8]),
            status=str(row[9]),
            primary_cursor_advanced=bool(row[10]),
            archive=_archive_from_row(row, start_index=11),
        )

    @classmethod
    def _read_source_batch_metadata(
        cls,
        cursor: Any,
        batch_id: UUID,
    ) -> PICSShadowSourceBatch:
        cursor.execute(
            """
            SELECT
              id,
              stream_key,
              lane,
              from_change_number,
              to_change_number,
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
              archive_bucket,
              archive_key,
              archive_content_hash,
              archive_byte_size,
              archive_content_type,
              received_at
            FROM ops.pics_change_batches
            WHERE id = %s
              AND work_mode = 'shadow'
            """,
            (batch_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise PICSBatchReconciliationError("Explicit first shadow source batch is missing")
        return cls._source_batch_from_row(row)

    @staticmethod
    def _source_batch_from_row(row: Sequence[Any]) -> PICSShadowSourceBatch:
        return PICSShadowSourceBatch(
            batch_id=UUID(str(row[0])),
            stream_key=str(row[1]),
            lane=str(row[2]),
            from_change_number=int(row[3]),
            to_change_number=int(row[4]),
            response_since_change_number=int(row[5]),
            source_app_count=int(row[6]),
            distinct_app_count=int(row[7]),
            durable_app_count=int(row[8]),
            app_changes_sha256=str(row[9]),
            force_full_update=bool(row[10]),
            force_full_app_update=bool(row[11]),
            force_full_package_update=bool(row[12]),
            source_complete=bool(row[13]),
            status=str(row[14]),
            archive=_archive_from_row(row, start_index=15),
            received_at=row[20],
            changes=(),
        )

    @staticmethod
    def _read_changes(
        cursor: Any,
        batch_ids: Sequence[UUID],
    ) -> dict[UUID, tuple[PICSSourceAppChange, ...]]:
        cursor.execute(
            """
            SELECT
              batch_id,
              source_index,
              appid,
              source_change_number,
              needs_token
            FROM ops.pics_change_batch_apps
            WHERE batch_id = ANY(%s)
            ORDER BY batch_id, source_index
            """,
            (list(batch_ids),),
        )
        changes: dict[UUID, list[PICSSourceAppChange]] = {}
        next_index: dict[UUID, int] = {}
        for row in cursor.fetchall():
            batch_id = UUID(str(row[0]))
            expected_index = next_index.get(batch_id, 0)
            if int(row[1]) != expected_index:
                raise PICSBatchReconciliationError(
                    f"Shadow batch {batch_id} has a non-sequential durable manifest"
                )
            changes.setdefault(batch_id, []).append(
                PICSSourceAppChange(
                    appid=int(row[2]),
                    change_number=int(row[3]),
                    needs_token=bool(row[4]),
                )
            )
            next_index[batch_id] = expected_index + 1
        return {batch_id: tuple(items) for batch_id, items in changes.items()}

    @staticmethod
    def _with_changes(
        batch: PICSShadowSourceBatch,
        changes: tuple[PICSSourceAppChange, ...],
    ) -> PICSShadowSourceBatch:
        return replace(batch, changes=changes)

    @staticmethod
    def _read_completed_provenance(
        cursor: Any,
        *,
        gap_evidence_batch_id: UUID,
    ) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT
              primary_batch_id,
              source_batch_id,
              gap_evidence_batch_id,
              source_stream_key,
              source_from_change_number,
              source_to_change_number,
              recovered_from_change_number,
              recovered_to_change_number,
              recovered_app_count,
              recovered_distinct_app_count,
              recovered_app_changes_sha256,
              plan_sha256,
              requested_by
            FROM ops.pics_shadow_gap_replay_provenance
            WHERE gap_evidence_batch_id = %s
            ORDER BY recovered_from_change_number
            LIMIT 5001
            """,
            (gap_evidence_batch_id,),
        )
        keys = (
            "primary_batch_id",
            "source_batch_id",
            "gap_evidence_batch_id",
            "source_stream_key",
            "source_from_change_number",
            "source_to_change_number",
            "recovered_from_change_number",
            "recovered_to_change_number",
            "recovered_app_count",
            "recovered_distinct_app_count",
            "recovered_app_changes_sha256",
            "plan_sha256",
            "requested_by",
        )
        return [dict(zip(keys, row, strict=True)) for row in cursor.fetchall()]


class PICSShadowGapReplayExecutor:
    """Archive and transactionally replay the pending suffix of one plan."""

    def __init__(
        self,
        *,
        intake_store: TigerPICSDurableIntakeStore,
        archive_store: S3ArchiveStore,
    ):
        self._intake_store = intake_store
        self._archive_store = archive_store

    def execute(
        self,
        plan: PICSShadowGapReplayPlan,
        *,
        approved_plan_sha256: str,
    ) -> PICSShadowGapReplayResult:
        """Execute only an exact reviewed plan hash, one atomic cursor step at a time."""

        approved_hash = approved_plan_sha256.strip().lower()
        if approved_hash != plan.plan_sha256:
            raise ValueError(
                "Replay execution requires the exact SHA-256 emitted by the dry-run plan"
            )

        current = self._intake_store.get_start_change_number(
            work_mode="durable",
            stream_key="primary",
        )
        if current != plan.current_change_number:
            raise PICSCursorMismatchError(
                f"Primary cursor changed after planning: expected "
                f"{plan.current_change_number}, received {current}"
            )

        gap_document = self._archive_store.read_json_verified(
            bucket=plan.gap_evidence.archive.bucket,
            key=plan.gap_evidence.archive.key,
            expected_content_hash=plan.gap_evidence.archive.content_hash,
            expected_byte_size=plan.gap_evidence.archive.byte_size,
            expected_content_type=plan.gap_evidence.archive.content_type,
        )
        _validate_gap_archive_document(plan.gap_evidence, gap_document)

        committed_batch_ids: list[UUID] = []
        for step in plan.pending_steps:
            current = self._intake_store.get_start_change_number(
                work_mode="durable",
                stream_key="primary",
            )
            if current != step.from_change_number:
                raise PICSCursorMismatchError(
                    f"Primary cursor {current} does not match replay step "
                    f"{step.from_change_number}"
                )

            source_document = self._archive_store.read_json_verified(
                bucket=step.source_batch.archive.bucket,
                key=step.source_batch.archive.key,
                expected_content_hash=step.source_batch.archive.content_hash,
                expected_byte_size=step.source_batch.archive.byte_size,
                expected_content_type=step.source_batch.archive.content_type,
            )
            _validate_source_archive_document(step.source_batch, source_document)
            replay_document = _build_replay_archive_document(plan, step)
            pointer = self._archive_store.write_json(
                content_hash=None,
                key_parts=[
                    "primary",
                    str(step.from_change_number),
                    str(step.to_change_number),
                    plan.plan_sha256,
                    str(step.source_batch.batch_id),
                ],
                kind="pics-change-response-replay",
                payload=replay_document,
            )
            persisted = self._intake_store.persist_batch(
                archive=PICSArchiveReference(
                    bucket=pointer.bucket,
                    key=pointer.key,
                    content_hash=pointer.content_hash,
                    byte_size=pointer.byte_size,
                    content_type=pointer.content_type,
                ),
                from_change_number=step.from_change_number,
                to_change_number=step.to_change_number,
                response_since_change_number=step.from_change_number,
                app_changes=step.app_changes,
                force_full_update=False,
                force_full_app_update=False,
                force_full_package_update=step.source_batch.force_full_package_update,
                work_mode="durable",
                stream_key="primary",
                lane=step.source_batch.lane,
                received_at=step.source_batch.received_at,
                replay_provenance=PICSReplayProvenance(
                    source_batch_id=step.source_batch.batch_id,
                    gap_evidence_batch_id=plan.gap_evidence.batch_id,
                    source_stream_key=plan.source_stream_key,
                    source_from_change_number=step.source_batch.from_change_number,
                    source_to_change_number=step.source_batch.to_change_number,
                    plan_sha256=plan.plan_sha256,
                    requested_by=plan.requested_by,
                    source_archive=step.source_batch.archive,
                    gap_archive=plan.gap_evidence.archive,
                ),
            )
            if (
                not persisted.source_complete
                or not persisted.primary_cursor_advanced
                or persisted.to_change_number != step.to_change_number
            ):
                raise PICSDurableIntakeError(
                    "Replay step committed without the expected primary cursor advancement"
                )
            committed_batch_ids.append(persisted.batch_id)

        return PICSShadowGapReplayResult(
            plan_sha256=plan.plan_sha256,
            start_change_number=plan.current_change_number,
            target_change_number=plan.target_change_number,
            previously_completed_steps=plan.completed_steps,
            newly_committed_batch_ids=tuple(committed_batch_ids),
        )


def plan_summary(plan: PICSShadowGapReplayPlan) -> dict[str, Any]:
    """Credential-free JSON summary emitted by the operator dry run."""

    return {
        "schemaVersion": PLAN_SCHEMA_VERSION,
        "planSha256": plan.plan_sha256,
        "gapEvidenceBatchId": str(plan.gap_evidence.batch_id),
        "sourceStreamKey": plan.source_stream_key,
        "expectedStartChangeNumber": plan.expected_start_change_number,
        "currentChangeNumber": plan.current_change_number,
        "targetChangeNumber": plan.target_change_number,
        "requestedBy": plan.requested_by,
        "stepCount": len(plan.steps),
        "completedSteps": plan.completed_steps,
        "pendingSteps": len(plan.pending_steps),
        "sourceAppCount": plan.source_app_count,
        "steps": [
            {
                "sequenceNumber": step.sequence_number,
                "sourceBatchId": str(step.source_batch.batch_id),
                "sourceFromChangeNumber": step.source_batch.from_change_number,
                "fromChangeNumber": step.from_change_number,
                "toChangeNumber": step.to_change_number,
                "sourceAppCount": step.source_app_count,
                "distinctAppCount": step.distinct_app_count,
                "appChangesSha256": step.app_changes_sha256,
                "sourceArchiveContentHash": step.source_batch.archive.content_hash,
            }
            for step in plan.steps
        ],
    }


def _validate_gap_evidence(
    gap: PICSForceFullGapEvidence,
    *,
    expected_start: int,
) -> None:
    if (
        gap.from_change_number != expected_start
        or gap.response_since_change_number != expected_start
        or not (gap.force_full_update or gap.force_full_app_update)
        or gap.source_complete
        or gap.status != "source_blocked"
        or gap.primary_cursor_advanced
    ):
        raise PICSBatchReconciliationError(
            "Replay gap evidence is not a source-blocked force-full response "
            "at the expected primary cursor"
        )
    _validate_archive_reference(gap.archive)


def _validate_shadow_batch(
    batch: PICSShadowSourceBatch,
    *,
    expected_stream: str,
) -> None:
    if (
        batch.stream_key != expected_stream
        or batch.stream_key == "primary"
        or batch.lane not in {"live", "catchup"}
        or batch.response_since_change_number != batch.from_change_number
        or batch.force_full_update
        or batch.force_full_app_update
        or not batch.source_complete
        or batch.status not in {"committed", "reconciled"}
        or batch.source_app_count != batch.durable_app_count
        or batch.source_app_count != len(batch.changes)
        or batch.distinct_app_count != len({change.appid for change in batch.changes})
        or batch.app_changes_sha256 != hash_pics_app_changes(batch.changes)
    ):
        raise PICSBatchReconciliationError(
            f"Shadow source batch {batch.batch_id} failed completeness or manifest validation"
        )
    for change in batch.changes:
        if not (batch.from_change_number < change.change_number <= batch.to_change_number):
            raise PICSBatchReconciliationError(
                f"Shadow source batch {batch.batch_id} contains an out-of-range app change"
            )
    _validate_archive_reference(batch.archive)


def _validate_completed_prefix(
    *,
    steps: Sequence[PICSShadowGapReplayStep],
    current_change_number: int,
    gap_evidence_batch_id: UUID,
    source_stream_key: str,
    requested_by: str,
    plan_sha256: str,
    completed_provenance: Sequence[Mapping[str, Any]],
) -> int:
    boundaries = [steps[0].from_change_number, *[step.to_change_number for step in steps]]
    if current_change_number not in boundaries:
        raise PICSCursorMismatchError("Primary cursor is not on a replay step boundary")
    completed_steps = boundaries.index(current_change_number)
    if len(completed_provenance) != completed_steps:
        raise PICSBatchReconciliationError(
            "Completed replay provenance does not exactly match the primary cursor prefix"
        )
    for step, row in zip(steps[:completed_steps], completed_provenance, strict=True):
        expected = (
            step.source_batch.batch_id,
            gap_evidence_batch_id,
            source_stream_key,
            step.source_batch.from_change_number,
            step.source_batch.to_change_number,
            step.from_change_number,
            step.to_change_number,
            step.source_app_count,
            step.distinct_app_count,
            step.app_changes_sha256,
            plan_sha256,
            requested_by,
        )
        actual = (
            UUID(str(row["source_batch_id"])),
            UUID(str(row["gap_evidence_batch_id"])),
            str(row["source_stream_key"]),
            int(row["source_from_change_number"]),
            int(row["source_to_change_number"]),
            int(row["recovered_from_change_number"]),
            int(row["recovered_to_change_number"]),
            int(row["recovered_app_count"]),
            int(row["recovered_distinct_app_count"]),
            str(row["recovered_app_changes_sha256"]),
            str(row["plan_sha256"]),
            str(row["requested_by"]),
        )
        if actual != expected:
            raise PICSBatchReconciliationError(
                "Completed replay provenance does not match the reviewed plan"
            )
    return completed_steps


def _hash_plan(
    *,
    gap_evidence: PICSForceFullGapEvidence,
    source_stream_key: str,
    expected_start_change_number: int,
    target_change_number: int,
    requested_by: str,
    steps: Sequence[PICSShadowGapReplayStep],
) -> str:
    payload = {
        "schema_version": PLAN_SCHEMA_VERSION,
        "gap_evidence_batch_id": str(gap_evidence.batch_id),
        "gap_archive": _archive_plan_payload(gap_evidence.archive),
        "source_stream_key": source_stream_key,
        "expected_start_change_number": expected_start_change_number,
        "target_change_number": target_change_number,
        "requested_by": requested_by,
        "steps": [
            {
                "sequence_number": step.sequence_number,
                "source_batch_id": str(step.source_batch.batch_id),
                "source_from_change_number": step.source_batch.from_change_number,
                "source_to_change_number": step.source_batch.to_change_number,
                "from_change_number": step.from_change_number,
                "to_change_number": step.to_change_number,
                "source_app_count": step.source_app_count,
                "distinct_app_count": step.distinct_app_count,
                "app_changes_sha256": step.app_changes_sha256,
                "source_archive": _archive_plan_payload(step.source_batch.archive),
            }
            for step in steps
        ],
    }
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _validate_source_archive_document(
    source: PICSShadowSourceBatch,
    document: Mapping[str, Any],
) -> None:
    expected_changes = [
        {
            "source_index": index,
            "appid": change.appid,
            "change_number": change.change_number,
            "needs_token": change.needs_token,
        }
        for index, change in enumerate(source.changes)
    ]
    expected = {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": source.stream_key,
        "work_mode": "shadow",
        "lane": source.lane,
        "from_change_number": source.from_change_number,
        "to_change_number": source.to_change_number,
        "response_since_change_number": source.response_since_change_number,
        "source_app_count": source.source_app_count,
        "distinct_app_count": source.distinct_app_count,
        "app_changes_sha256": source.app_changes_sha256,
        "force_full_update": source.force_full_update,
        "force_full_app_update": source.force_full_app_update,
        "force_full_package_update": source.force_full_package_update,
        "app_changes": expected_changes,
    }
    for key, expected_value in expected.items():
        if document.get(key) != expected_value:
            raise PICSBatchReconciliationError(
                f"Shadow source archive field {key!r} does not match Tiger evidence"
            )
    if not isinstance(document.get("package_changes"), list):
        raise PICSBatchReconciliationError("Shadow source archive package_changes must be a list")


def _validate_gap_archive_document(
    gap: PICSForceFullGapEvidence,
    document: Mapping[str, Any],
) -> None:
    expected = {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": "primary",
        "work_mode": "durable",
        "from_change_number": gap.from_change_number,
        "to_change_number": gap.to_change_number,
        "response_since_change_number": gap.response_since_change_number,
        "force_full_update": gap.force_full_update,
        "force_full_app_update": gap.force_full_app_update,
    }
    for key, expected_value in expected.items():
        if document.get(key) != expected_value:
            raise PICSBatchReconciliationError(
                f"Primary gap archive field {key!r} does not match Tiger evidence"
            )
    if not isinstance(document.get("app_changes"), list) or not isinstance(
        document.get("package_changes"), list
    ):
        raise PICSBatchReconciliationError(
            "Primary gap archive app_changes and package_changes must be lists"
        )


def _build_replay_archive_document(
    plan: PICSShadowGapReplayPlan,
    step: PICSShadowGapReplayStep,
) -> dict[str, Any]:
    return {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": "primary",
        "work_mode": "durable",
        "lane": step.source_batch.lane,
        "from_change_number": step.from_change_number,
        "to_change_number": step.to_change_number,
        "response_since_change_number": step.from_change_number,
        "source_app_count": step.source_app_count,
        "distinct_app_count": step.distinct_app_count,
        "app_changes_sha256": step.app_changes_sha256,
        "force_full_update": False,
        "force_full_app_update": False,
        "force_full_package_update": step.source_batch.force_full_package_update,
        "app_changes": [
            {
                "source_index": index,
                "appid": change.appid,
                "change_number": change.change_number,
                "needs_token": change.needs_token,
            }
            for index, change in enumerate(step.app_changes)
        ],
        "package_changes": [],
        "replay_provenance": {
            "schema_version": ARCHIVE_PROVENANCE_VERSION,
            "plan_sha256": plan.plan_sha256,
            "requested_by": plan.requested_by,
            "gap_evidence_batch_id": str(plan.gap_evidence.batch_id),
            "gap_archive": _archive_plan_payload(plan.gap_evidence.archive),
            "source_batch_id": str(step.source_batch.batch_id),
            "source_stream_key": step.source_batch.stream_key,
            "source_from_change_number": step.source_batch.from_change_number,
            "source_to_change_number": step.source_batch.to_change_number,
            "source_archive": {
                "bucket": step.source_batch.archive.bucket,
                "key": step.source_batch.archive.key,
                "content_hash": step.source_batch.archive.content_hash,
                "byte_size": step.source_batch.archive.byte_size,
                "content_type": step.source_batch.archive.content_type,
            },
        },
    }


def _archive_from_row(row: Sequence[Any], *, start_index: int) -> PICSArchiveReference:
    if any(row[index] is None for index in range(start_index, start_index + 5)):
        raise PICSBatchReconciliationError("PICS replay evidence is missing its archive")
    archive = PICSArchiveReference(
        bucket=str(row[start_index]),
        key=str(row[start_index + 1]),
        content_hash=str(row[start_index + 2]),
        byte_size=int(row[start_index + 3]),
        content_type=str(row[start_index + 4]),
    )
    _validate_archive_reference(archive)
    return archive


def _validate_archive_reference(archive: PICSArchiveReference) -> None:
    if (
        not archive.bucket.strip()
        or not archive.key.strip()
        or not archive.content_type.strip()
        or archive.byte_size < 0
        or len(archive.content_hash) != 64
        or any(character not in "0123456789abcdef" for character in archive.content_hash)
    ):
        raise PICSBatchReconciliationError("PICS replay archive reference is invalid")


def _archive_plan_payload(archive: PICSArchiveReference) -> dict[str, Any]:
    return {
        "bucket": archive.bucket,
        "key": archive.key,
        "content_hash": archive.content_hash,
        "byte_size": archive.byte_size,
        "content_type": archive.content_type,
    }
