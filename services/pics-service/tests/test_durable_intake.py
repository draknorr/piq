# ruff: noqa: E402, I001

import sys
from contextlib import AbstractContextManager
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config.settings import Settings, resolve_pics_work_mode  # noqa: E402
from src.database.durable_intake import (
    PICSArchiveReference,
    PICSSourceAppChange,
    PICSBatchReconciliationError,
    PICSCursorMismatchError,
    TigerPICSDurableIntakeStore,
    hash_pics_app_changes,
)  # noqa: E402


BATCH_ID = UUID("11111111-1111-4111-8111-111111111111")
ARCHIVE = PICSArchiveReference(
    bucket="pics-archive",
    key="pics-change-response/test.json",
    content_hash="a" * 64,
    byte_size=123,
    content_type="application/json",
)


def app_change(appid, change_number, needs_token=False):
    return PICSSourceAppChange(
        appid=appid,
        change_number=change_number,
        needs_token=needs_token,
    )


class FakeCopy(AbstractContextManager):
    def __init__(self, cursor):
        self._cursor = cursor

    def __enter__(self):
        return self

    def write_row(self, row):
        self._cursor.copied_rows.append(tuple(row))

    def set_types(self, types):
        self._cursor.copy_types = list(types)

    def __exit__(self, exc_type, exc_value, traceback):
        return False


class FakeCursor(AbstractContextManager):
    def __init__(
        self,
        *,
        primary_cursor=10,
        existing_batch=None,
        fail_on=None,
        manifest_override=None,
    ):
        self.primary_cursor = primary_cursor
        self.existing_batch = existing_batch
        self.fail_on = fail_on
        self.manifest_override = manifest_override
        self.events = []
        self.copied_rows = []
        self.copy_types = []
        self.rowcount = -1
        self._next_row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.events.append((normalized, params))
        if self.fail_on and self.fail_on in normalized:
            raise RuntimeError("injected transaction failure")

        self.rowcount = -1
        self._next_row = None
        if "SELECT last_change_number" in normalized:
            self._next_row = (self.primary_cursor,)
        elif (
            "FROM ops.pics_change_batches" in normalized and "from_change_number = %s" in normalized
        ):
            self._next_row = self.existing_batch
        elif "FROM pics_batch_stage" in normalized and "count(*)::integer" in normalized:
            self._next_row = self._manifest()
        elif normalized.startswith("INSERT INTO ops.pics_change_batches"):
            self._next_row = (BATCH_ID,)
        elif "FROM ops.pics_change_batch_apps" in normalized and "count(*)::integer" in normalized:
            self._next_row = self._manifest()
        elif normalized.startswith("UPDATE ops.pics_sync_state"):
            self.rowcount = 1

    def fetchone(self):
        return self._next_row

    def copy(self, _query):
        return FakeCopy(self)

    def _manifest(self):
        if self.manifest_override is not None:
            return self.manifest_override
        if self.existing_batch is not None and not self.copied_rows:
            return (
                int(self.existing_batch[6]),
                int(self.existing_batch[5]),
                str(self.existing_batch[7]),
            )
        changes = [
            app_change(appid, change_number, needs_token)
            for _, appid, change_number, needs_token in self.copied_rows
        ]
        return (
            len(changes),
            len({change.appid for change in changes}),
            hash_pics_app_changes(changes),
        )


class FakeTransaction(AbstractContextManager):
    def __init__(self, connection):
        self._connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is None:
            self._connection.committed = True
        else:
            self._connection.rolled_back = True
        return False


class FakeConnection(AbstractContextManager):
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def transaction(self):
        return FakeTransaction(self)

    def cursor(self):
        return self._cursor


def make_store(cursor):
    connection = FakeConnection(cursor)
    store = TigerPICSDurableIntakeStore(
        "",
        connection_factory=lambda: connection,
    )
    return store, connection


def test_hash_retains_order_positions_duplicates_and_source_metadata():
    changes = [app_change(7, 11), app_change(7, 12, True), app_change(9, 13)]
    assert hash_pics_app_changes(changes) == hash_pics_app_changes(changes)
    assert hash_pics_app_changes(
        [app_change(7, 12, True), app_change(7, 11), app_change(9, 13)]
    ) != hash_pics_app_changes(changes)
    assert hash_pics_app_changes(
        [app_change(7, 11), app_change(7, 12), app_change(9, 13)]
    ) != hash_pics_app_changes(changes)
    assert hash_pics_app_changes([]) == (
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    )


def test_hash_rejects_invalid_appid():
    with pytest.raises(ValueError, match="positive integers"):
        hash_pics_app_changes([app_change(0, 11)])


def test_work_mode_is_explicit_and_fail_closed():
    assert resolve_pics_work_mode(" SHADOW ") == "shadow"
    with pytest.raises(ValueError, match="requires explicit"):
        resolve_pics_work_mode(None)
    with pytest.raises(ValueError, match="requires explicit"):
        resolve_pics_work_mode("unexpected")


def test_pics_product_targets_default_to_tiger():
    assert Settings.model_fields["pics_change_history_target"].default == "tiger"
    assert Settings.model_fields["pics_latest_state_target"].default == "tiger"


def test_persist_batch_requires_archive_before_opening_transaction():
    cursor = FakeCursor(primary_cursor=10)
    store, connection = make_store(cursor)

    with pytest.raises(ValueError, match="archive reference is required"):
        store.persist_batch(
            archive=None,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=[app_change(7, 11)],
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )

    assert cursor.events == []
    assert connection.committed is False
    assert connection.rolled_back is False


def test_persist_batch_copies_every_source_position_before_cursor_update():
    cursor = FakeCursor(primary_cursor=10)
    store, connection = make_store(cursor)

    result = store.persist_batch(
        archive=ARCHIVE,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=[
            app_change(7, 11),
            app_change(7, 12, True),
            app_change(9, 20),
        ],
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        work_mode="durable",
        stream_key="primary",
        received_at=datetime(2026, 7, 24, tzinfo=timezone.utc),
    )

    assert connection.committed is True
    assert connection.rolled_back is False
    assert cursor.copied_rows == [
        (0, 7, 11, False),
        (1, 7, 12, True),
        (2, 9, 20, False),
    ]
    assert cursor.copy_types == ["int4", "int4", "int8", "bool"]
    assert result.source_app_count == 3
    assert result.distinct_app_count == 2
    assert result.durable_app_count == 3
    assert result.primary_cursor_advanced is True
    assert result.idempotent_replay is False

    statements = [query for query, _ in cursor.events]
    child_insert = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("INSERT INTO ops.pics_change_batch_apps")
    )
    work_upsert = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("WITH incoming AS")
    )
    cursor_update = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("UPDATE ops.pics_sync_state")
    )
    assert child_insert < work_upsert < cursor_update


def test_work_upsert_uses_each_apps_staged_change_numbers():
    cursor = FakeCursor(primary_cursor=10)
    store, connection = make_store(cursor)

    store.persist_batch(
        archive=ARCHIVE,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=[
            app_change(7, 11),
            app_change(7, 18),
            app_change(9, 20),
        ],
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        work_mode="durable",
        stream_key="primary",
    )

    work_query, work_params = next(
        (query, params) for query, params in cursor.events if query.startswith("WITH incoming AS")
    )

    assert "min(source_change_number) AS first_change_number" in work_query
    assert "max(source_change_number) AS latest_change_number" in work_query
    assert "incoming.first_change_number, incoming.latest_change_number" in work_query
    assert "first_batch_id = coalesce(" in work_query
    assert "ops.pics_work_state.first_batch_id" in work_query
    assert "reconciliation.status = 'active'" in work_query
    assert "THEN ops.pics_work_state.reconciliation_run_id" in work_query
    requeue_query = next(
        query
        for query, _params in cursor.events
        if query.startswith("UPDATE ops.pics_reconciliation_items")
    )
    assert "last_requeued_by = 'durable_live_intake'" in requeue_query
    assert "work.latest_batch_id = %s" in requeue_query
    assert "'completed'," in requeue_query
    assert "'source_blocked'," in requeue_query
    assert "'dead_letter'" in requeue_query
    assert len(work_params) == 8
    assert 20 not in work_params
    assert connection.committed is True


@pytest.mark.parametrize(
    "failure_boundary",
    [
        "INSERT INTO ops.pics_change_batches",
        "INSERT INTO ops.pics_change_batch_apps",
        "WITH incoming AS",
        "INSERT INTO ops.app_data_readiness",
        "UPDATE ops.pics_sync_state",
    ],
)
def test_each_durable_intake_failure_boundary_rolls_back(failure_boundary):
    cursor = FakeCursor(primary_cursor=10, fail_on=failure_boundary)
    store, connection = make_store(cursor)

    with pytest.raises(RuntimeError, match="injected transaction failure"):
        store.persist_batch(
            archive=ARCHIVE,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=[app_change(7, 11), app_change(9, 20)],
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )

    assert connection.committed is False
    assert connection.rolled_back is True


def test_staging_manifest_mismatch_rolls_back_before_batch_insert():
    cursor = FakeCursor(
        primary_cursor=10,
        manifest_override=(2, 2, "0" * 64),
    )
    store, connection = make_store(cursor)

    with pytest.raises(PICSBatchReconciliationError, match="Staged"):
        store.persist_batch(
            archive=ARCHIVE,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=[app_change(7, 11), app_change(9, 20)],
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )

    statements = [query for query, _ in cursor.events]
    assert not any(
        statement.startswith("INSERT INTO ops.pics_change_batches") for statement in statements
    )
    assert connection.rolled_back is True


def test_mismatched_primary_cursor_fails_before_staging():
    cursor = FakeCursor(primary_cursor=11)
    store, connection = make_store(cursor)

    with pytest.raises(PICSCursorMismatchError, match="batch begins at 10"):
        store.persist_batch(
            archive=ARCHIVE,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=[app_change(7, 11)],
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )

    assert cursor.copied_rows == []
    assert connection.rolled_back is True


def test_shadow_batch_never_updates_primary_cursor_or_canonical_readiness():
    cursor = FakeCursor()
    store, connection = make_store(cursor)

    result = store.persist_batch(
        archive=ARCHIVE,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=[app_change(7, 11), app_change(9, 20)],
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        work_mode="shadow",
        stream_key="replay-test",
    )

    statements = [query for query, _ in cursor.events]
    assert result.primary_cursor_advanced is False
    assert not any(statement.startswith("UPDATE ops.pics_sync_state") for statement in statements)
    assert not any(
        statement.startswith("INSERT INTO ops.app_data_readiness") for statement in statements
    )
    assert not any(
        statement.startswith("UPDATE ops.pics_reconciliation_items") for statement in statements
    )
    assert connection.committed is True


@pytest.mark.parametrize(
    ("response_since_change_number", "force_full_update", "force_full_app_update"),
    [
        (9, False, False),
        (10, True, False),
        (10, False, True),
    ],
)
def test_incomplete_source_response_is_retained_without_work_or_cursor_advance(
    response_since_change_number,
    force_full_update,
    force_full_app_update,
):
    cursor = FakeCursor(primary_cursor=10)
    store, connection = make_store(cursor)

    result = store.persist_batch(
        archive=ARCHIVE,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=response_since_change_number,
        app_changes=[app_change(7, 11), app_change(9, 20)],
        force_full_update=force_full_update,
        force_full_app_update=force_full_app_update,
        force_full_package_update=False,
        work_mode="durable",
        stream_key="primary",
    )

    statements = [query for query, _ in cursor.events]
    assert result.source_complete is False
    assert result.status == "source_blocked"
    assert result.primary_cursor_advanced is False
    assert any(
        statement.startswith("INSERT INTO ops.pics_change_batches") for statement in statements
    )
    assert any(
        statement.startswith("INSERT INTO ops.pics_change_batch_apps") for statement in statements
    )
    assert not any(statement.startswith("WITH incoming AS") for statement in statements)
    assert not any(
        statement.startswith("INSERT INTO ops.app_data_readiness") for statement in statements
    )
    assert not any(statement.startswith("UPDATE ops.pics_sync_state") for statement in statements)
    assert connection.committed is True


def test_package_only_force_full_does_not_block_app_cursor():
    cursor = FakeCursor(primary_cursor=10)
    store, _connection = make_store(cursor)

    result = store.persist_batch(
        archive=ARCHIVE,
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=[app_change(7, 11)],
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=True,
        work_mode="durable",
        stream_key="primary",
    )

    assert result.source_complete is True
    assert result.force_full_package_update is True
    assert result.primary_cursor_advanced is True


def test_complete_response_rejects_app_change_outside_cursor_range():
    cursor = FakeCursor(primary_cursor=10)
    store, _connection = make_store(cursor)

    with pytest.raises(PICSBatchReconciliationError, match="outside"):
        store.persist_batch(
            archive=ARCHIVE,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=[app_change(7, 10)],
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )


def test_exact_committed_batch_retry_is_idempotent():
    app_changes = [
        app_change(7, 11),
        app_change(7, 12, True),
        app_change(9, 20),
    ]
    existing = (
        BATCH_ID,
        "durable",
        "live",
        10,
        3,
        2,
        3,
        hash_pics_app_changes(app_changes),
        False,
        False,
        False,
        True,
        "committed",
        True,
        ARCHIVE.bucket,
        ARCHIVE.key,
        ARCHIVE.content_hash,
        ARCHIVE.byte_size,
        ARCHIVE.content_type,
    )
    cursor = FakeCursor(primary_cursor=20, existing_batch=existing)
    store, connection = make_store(cursor)

    result = store.persist_batch(
        archive=PICSArchiveReference(
            bucket=ARCHIVE.bucket,
            key="pics-change-response/replayed-on-another-day.json",
            content_hash=ARCHIVE.content_hash,
            byte_size=ARCHIVE.byte_size,
            content_type=ARCHIVE.content_type,
        ),
        from_change_number=10,
        to_change_number=20,
        response_since_change_number=10,
        app_changes=app_changes,
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
        work_mode="durable",
        stream_key="primary",
    )

    assert result.batch_id == BATCH_ID
    assert result.idempotent_replay is True
    assert cursor.copied_rows == []
    assert connection.committed is True


def test_committed_batch_retry_rejects_missing_archive_provenance():
    app_changes = [app_change(7, 20)]
    existing = (
        BATCH_ID,
        "durable",
        "live",
        10,
        1,
        1,
        1,
        hash_pics_app_changes(app_changes),
        False,
        False,
        False,
        True,
        "committed",
        True,
        None,
        None,
        None,
        None,
        None,
    )
    cursor = FakeCursor(primary_cursor=20, existing_batch=existing)
    store, connection = make_store(cursor)

    with pytest.raises(PICSBatchReconciliationError, match="missing its required archive"):
        store.persist_batch(
            archive=ARCHIVE,
            from_change_number=10,
            to_change_number=20,
            response_since_change_number=10,
            app_changes=app_changes,
            force_full_update=False,
            force_full_app_update=False,
            force_full_package_update=False,
            work_mode="durable",
            stream_key="primary",
        )

    assert connection.committed is False
    assert connection.rolled_back is True
