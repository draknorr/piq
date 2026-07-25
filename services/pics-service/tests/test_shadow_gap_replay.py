# ruff: noqa: E402, I001

import sys
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.durable_intake import (  # noqa: E402
    PICSArchiveReference,
    PICSBatchReconciliationError,
    PICSSourceAppChange,
    PersistedPICSBatch,
    hash_pics_app_changes,
)
from src.database.shadow_gap_replay import (  # noqa: E402
    PICSForceFullGapEvidence,
    PICSShadowGapReplayExecutor,
    PICSShadowSourceBatch,
    assemble_shadow_gap_replay_plan,
)


GAP_ID = UUID("11111111-1111-4111-8111-111111111111")
FIRST_ID = UUID("22222222-2222-4222-8222-222222222222")
SECOND_ID = UUID("33333333-3333-4333-8333-333333333333")
PRIMARY_FIRST_ID = UUID("44444444-4444-4444-8444-444444444444")
PRIMARY_SECOND_ID = UUID("55555555-5555-4555-8555-555555555555")
SOURCE_STREAM = "shadow-reviewed"
REQUESTED_BY = "operator@example.com"


def archive(seed: str) -> PICSArchiveReference:
    return PICSArchiveReference(
        bucket="pics-archive",
        key=f"pics/{seed}.json",
        content_hash=seed * 64,
        byte_size=123,
        content_type="application/json",
    )


def change(appid: int, change_number: int, needs_token: bool = False) -> PICSSourceAppChange:
    return PICSSourceAppChange(appid, change_number, needs_token)


def gap() -> PICSForceFullGapEvidence:
    return PICSForceFullGapEvidence(
        batch_id=GAP_ID,
        from_change_number=10,
        to_change_number=30,
        response_since_change_number=10,
        force_full_update=False,
        force_full_app_update=True,
        source_complete=False,
        status="source_blocked",
        primary_cursor_advanced=False,
        archive=archive("a"),
    )


def source_batch(
    *,
    batch_id: UUID,
    from_change_number: int,
    to_change_number: int,
    changes: tuple[PICSSourceAppChange, ...],
    archive_seed: str,
) -> PICSShadowSourceBatch:
    return PICSShadowSourceBatch(
        batch_id=batch_id,
        stream_key=SOURCE_STREAM,
        lane="live",
        from_change_number=from_change_number,
        to_change_number=to_change_number,
        response_since_change_number=from_change_number,
        source_app_count=len(changes),
        distinct_app_count=len({item.appid for item in changes}),
        durable_app_count=len(changes),
        app_changes_sha256=hash_pics_app_changes(changes),
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        source_complete=True,
        status="committed",
        archive=archive(archive_seed),
        received_at=datetime(2026, 7, 25, tzinfo=timezone.utc),
        changes=changes,
    )


def source_batches() -> tuple[PICSShadowSourceBatch, ...]:
    return (
        source_batch(
            batch_id=FIRST_ID,
            from_change_number=5,
            to_change_number=12,
            changes=(change(1, 6), change(2, 11), change(3, 12, True)),
            archive_seed="b",
        ),
        source_batch(
            batch_id=SECOND_ID,
            from_change_number=12,
            to_change_number=20,
            changes=(change(4, 14), change(5, 20)),
            archive_seed="c",
        ),
    )


def build_plan(
    *,
    current_change_number: int = 10,
    completed_provenance=(),
):
    return assemble_shadow_gap_replay_plan(
        gap_evidence=gap(),
        source_stream_key=SOURCE_STREAM,
        first_source_batch_id=FIRST_ID,
        expected_start_change_number=10,
        target_change_number=20,
        current_change_number=current_change_number,
        requested_by=REQUESTED_BY,
        source_batches=source_batches(),
        completed_provenance=completed_provenance,
    )


def source_document(batch: PICSShadowSourceBatch) -> dict:
    return {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": batch.stream_key,
        "work_mode": "shadow",
        "lane": batch.lane,
        "from_change_number": batch.from_change_number,
        "to_change_number": batch.to_change_number,
        "response_since_change_number": batch.response_since_change_number,
        "source_app_count": batch.source_app_count,
        "distinct_app_count": batch.distinct_app_count,
        "app_changes_sha256": batch.app_changes_sha256,
        "force_full_update": batch.force_full_update,
        "force_full_app_update": batch.force_full_app_update,
        "force_full_package_update": batch.force_full_package_update,
        "app_changes": [
            {
                "source_index": index,
                "appid": item.appid,
                "change_number": item.change_number,
                "needs_token": item.needs_token,
            }
            for index, item in enumerate(batch.changes)
        ],
        "package_changes": [],
    }


def gap_document() -> dict:
    evidence = gap()
    return {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": "primary",
        "work_mode": "durable",
        "lane": "live",
        "from_change_number": evidence.from_change_number,
        "to_change_number": evidence.to_change_number,
        "response_since_change_number": evidence.response_since_change_number,
        "source_app_count": 1,
        "distinct_app_count": 1,
        "app_changes_sha256": "f" * 64,
        "force_full_update": evidence.force_full_update,
        "force_full_app_update": evidence.force_full_app_update,
        "force_full_package_update": False,
        "app_changes": [],
        "package_changes": [],
    }


def test_plan_filters_exact_overlap_suffix_and_requires_contiguous_batches():
    plan = build_plan()

    assert plan.expected_start_change_number == 10
    assert plan.target_change_number == 20
    assert plan.completed_steps == 0
    assert len(plan.plan_sha256) == 64
    assert [(step.from_change_number, step.to_change_number) for step in plan.steps] == [
        (10, 12),
        (12, 20),
    ]
    assert plan.steps[0].app_changes == (change(2, 11), change(3, 12, True))
    assert plan.steps[1].app_changes == (change(4, 14), change(5, 20))
    assert build_plan().plan_sha256 == plan.plan_sha256


def test_plan_rejects_missing_or_ambiguous_chain():
    with pytest.raises(PICSBatchReconciliationError, match="missing or ambiguous"):
        assemble_shadow_gap_replay_plan(
            gap_evidence=gap(),
            source_stream_key=SOURCE_STREAM,
            first_source_batch_id=FIRST_ID,
            expected_start_change_number=10,
            target_change_number=20,
            current_change_number=10,
            requested_by=REQUESTED_BY,
            source_batches=(source_batches()[0],),
        )

    duplicate = source_batch(
        batch_id=UUID("66666666-6666-4666-8666-666666666666"),
        from_change_number=12,
        to_change_number=18,
        changes=(change(6, 18),),
        archive_seed="d",
    )
    with pytest.raises(PICSBatchReconciliationError, match="missing or ambiguous"):
        assemble_shadow_gap_replay_plan(
            gap_evidence=gap(),
            source_stream_key=SOURCE_STREAM,
            first_source_batch_id=FIRST_ID,
            expected_start_change_number=10,
            target_change_number=20,
            current_change_number=10,
            requested_by=REQUESTED_BY,
            source_batches=(*source_batches(), duplicate),
        )


def test_plan_rejects_unproven_force_full_gap_and_tampered_manifest():
    invalid_gap = replace(gap(), force_full_app_update=False)
    with pytest.raises(PICSBatchReconciliationError, match="force-full"):
        assemble_shadow_gap_replay_plan(
            gap_evidence=invalid_gap,
            source_stream_key=SOURCE_STREAM,
            first_source_batch_id=FIRST_ID,
            expected_start_change_number=10,
            target_change_number=20,
            current_change_number=10,
            requested_by=REQUESTED_BY,
            source_batches=source_batches(),
        )

    tampered = replace(source_batches()[0], app_changes_sha256="0" * 64)
    with pytest.raises(PICSBatchReconciliationError, match="manifest"):
        assemble_shadow_gap_replay_plan(
            gap_evidence=gap(),
            source_stream_key=SOURCE_STREAM,
            first_source_batch_id=FIRST_ID,
            expected_start_change_number=10,
            target_change_number=20,
            current_change_number=10,
            requested_by=REQUESTED_BY,
            source_batches=(tampered, source_batches()[1]),
        )


def test_restart_requires_exact_completed_provenance_prefix():
    original = build_plan()
    first = original.steps[0]
    completed = {
        "primary_batch_id": PRIMARY_FIRST_ID,
        "source_batch_id": first.source_batch.batch_id,
        "gap_evidence_batch_id": GAP_ID,
        "source_stream_key": SOURCE_STREAM,
        "source_from_change_number": first.source_batch.from_change_number,
        "source_to_change_number": first.source_batch.to_change_number,
        "recovered_from_change_number": first.from_change_number,
        "recovered_to_change_number": first.to_change_number,
        "recovered_app_count": first.source_app_count,
        "recovered_distinct_app_count": first.distinct_app_count,
        "recovered_app_changes_sha256": first.app_changes_sha256,
        "plan_sha256": original.plan_sha256,
        "requested_by": REQUESTED_BY,
    }
    resumed = build_plan(
        current_change_number=12,
        completed_provenance=(completed,),
    )
    assert resumed.plan_sha256 == original.plan_sha256
    assert resumed.completed_steps == 1
    assert resumed.pending_steps == (resumed.steps[1],)

    with pytest.raises(PICSBatchReconciliationError, match="reviewed plan"):
        build_plan(
            current_change_number=12,
            completed_provenance=({**completed, "plan_sha256": "0" * 64},),
        )


class FakeArchiveStore:
    def __init__(self, documents, *, read_error=None, write_error=None):
        self.documents = documents
        self.read_error = read_error
        self.write_error = write_error
        self.read_calls = []
        self.write_calls = []

    def read_json_verified(self, **kwargs):
        self.read_calls.append(kwargs)
        if self.read_error:
            raise self.read_error
        return self.documents[kwargs["expected_content_hash"]]

    def write_json(self, **kwargs):
        self.write_calls.append(kwargs)
        if self.write_error:
            raise self.write_error
        index = len(self.write_calls)
        return SimpleNamespace(
            bucket="replay-archive",
            key=f"replay/{index}.json",
            content_hash=str(index) * 64,
            byte_size=456,
            content_type="application/json",
        )


class FakeIntakeStore:
    def __init__(self, cursor=10, *, fail_on_call=None):
        self.cursor = cursor
        self.fail_on_call = fail_on_call
        self.persist_calls = []

    def get_start_change_number(self, **_kwargs):
        return self.cursor

    def persist_batch(self, **kwargs):
        self.persist_calls.append(kwargs)
        if self.fail_on_call == len(self.persist_calls):
            raise RuntimeError("injected intake failure")
        assert kwargs["from_change_number"] == self.cursor
        self.cursor = kwargs["to_change_number"]
        app_changes = kwargs["app_changes"]
        batch_id = PRIMARY_FIRST_ID if len(self.persist_calls) == 1 else PRIMARY_SECOND_ID
        return PersistedPICSBatch(
            batch_id=batch_id,
            stream_key="primary",
            work_mode="durable",
            lane="live",
            from_change_number=kwargs["from_change_number"],
            to_change_number=kwargs["to_change_number"],
            response_since_change_number=kwargs["response_since_change_number"],
            source_app_count=len(app_changes),
            distinct_app_count=len({item.appid for item in app_changes}),
            durable_app_count=len(app_changes),
            app_changes_sha256=hash_pics_app_changes(app_changes),
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            source_complete=True,
            status="committed",
            primary_cursor_advanced=True,
            idempotent_replay=False,
        )


def make_executor(*, intake=None, archive_store=None):
    plan = build_plan()
    documents = {batch.archive.content_hash: source_document(batch) for batch in source_batches()}
    documents[plan.gap_evidence.archive.content_hash] = gap_document()
    intake = intake or FakeIntakeStore()
    archive_store = archive_store or FakeArchiveStore(documents)
    return (
        plan,
        intake,
        archive_store,
        PICSShadowGapReplayExecutor(
            intake_store=intake,
            archive_store=archive_store,
        ),
    )


def test_executor_requires_exact_plan_hash_before_any_write():
    plan, intake, archive_store, executor = make_executor()

    with pytest.raises(ValueError, match="exact SHA-256"):
        executor.execute(plan, approved_plan_sha256="0" * 64)

    assert intake.persist_calls == []
    assert archive_store.read_calls == []
    assert archive_store.write_calls == []


def test_executor_verifies_source_archives_and_commits_each_cursor_step():
    plan, intake, archive_store, executor = make_executor()

    result = executor.execute(plan, approved_plan_sha256=plan.plan_sha256)

    assert intake.cursor == 20
    assert result.newly_committed_batch_ids == (PRIMARY_FIRST_ID, PRIMARY_SECOND_ID)
    assert len(archive_store.read_calls) == 3
    assert archive_store.read_calls[0]["key"] == plan.gap_evidence.archive.key
    assert len(archive_store.write_calls) == 2
    first_archive = archive_store.write_calls[0]["payload"]
    assert first_archive["app_changes"] == [
        {
            "source_index": 0,
            "appid": 2,
            "change_number": 11,
            "needs_token": False,
        },
        {
            "source_index": 1,
            "appid": 3,
            "change_number": 12,
            "needs_token": True,
        },
    ]
    assert first_archive["replay_provenance"]["plan_sha256"] == plan.plan_sha256
    assert first_archive["replay_provenance"]["source_batch_id"] == str(FIRST_ID)
    assert intake.persist_calls[0]["replay_provenance"].gap_evidence_batch_id == GAP_ID


def test_archive_or_transaction_failure_stops_without_advancing_later_steps():
    plan, intake, archive_store, executor = make_executor(
        archive_store=FakeArchiveStore(
            {
                gap().archive.content_hash: gap_document(),
                **{
                    batch.archive.content_hash: source_document(batch) for batch in source_batches()
                },
            },
            read_error=ValueError("source archive hash mismatch"),
        )
    )
    with pytest.raises(ValueError, match="hash mismatch"):
        executor.execute(plan, approved_plan_sha256=plan.plan_sha256)
    assert intake.cursor == 10
    assert intake.persist_calls == []
    assert archive_store.write_calls == []

    failing_intake = FakeIntakeStore(fail_on_call=2)
    plan, intake, archive_store, executor = make_executor(intake=failing_intake)
    with pytest.raises(RuntimeError, match="injected intake failure"):
        executor.execute(plan, approved_plan_sha256=plan.plan_sha256)
    assert intake.cursor == 12
    assert len(intake.persist_calls) == 2
    assert len(archive_store.write_calls) == 2


def test_executor_rejects_archive_body_that_differs_from_tiger_manifest():
    plan = build_plan()
    documents = {batch.archive.content_hash: source_document(batch) for batch in source_batches()}
    documents[plan.gap_evidence.archive.content_hash] = gap_document()
    documents[source_batches()[0].archive.content_hash] = {
        **documents[source_batches()[0].archive.content_hash],
        "source_app_count": 999,
    }
    intake = FakeIntakeStore()
    archive_store = FakeArchiveStore(documents)
    executor = PICSShadowGapReplayExecutor(
        intake_store=intake,
        archive_store=archive_store,
    )

    with pytest.raises(PICSBatchReconciliationError, match="source_app_count"):
        executor.execute(plan, approved_plan_sha256=plan.plan_sha256)

    assert intake.cursor == 10
    assert intake.persist_calls == []
    assert archive_store.write_calls == []


def test_executor_rejects_gap_archive_body_before_any_replay_write():
    plan = build_plan()
    documents = {batch.archive.content_hash: source_document(batch) for batch in source_batches()}
    documents[plan.gap_evidence.archive.content_hash] = {
        **gap_document(),
        "force_full_app_update": False,
    }
    intake = FakeIntakeStore()
    archive_store = FakeArchiveStore(documents)
    executor = PICSShadowGapReplayExecutor(
        intake_store=intake,
        archive_store=archive_store,
    )

    with pytest.raises(PICSBatchReconciliationError, match="force_full_app_update"):
        executor.execute(plan, approved_plan_sha256=plan.plan_sha256)

    assert intake.cursor == 10
    assert intake.persist_calls == []
    assert archive_store.write_calls == []
