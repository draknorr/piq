from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest

from src.database.durable_payload import validate_pics_product_payload
from src.database.durable_promotion import TigerPICSDurablePromoter
from src.database.durable_work import PICSWorkClaim, TigerPICSDurableWorkStore
from src.database.tiger_change_history import ArchivePointer


def make_payload():
    raw = {
        "appid": 7,
        "_change_number": 20,
        "_missing_token": False,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": "Test app",
            "type": "game",
            "category": {},
            "genres": {},
            "store_tags": {},
            "associations": {},
        },
        "extended": {"listofdlc": ""},
        "config": {},
        "depots": {},
    }
    return validate_pics_product_payload(
        appid=7,
        claimed_through_change_number=20,
        raw_payload=raw,
    )


def make_payload_with_absent_tags():
    raw = {
        "appid": 7,
        "_change_number": 20,
        "_missing_token": False,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": "Test app",
            "type": "game",
            "category": {},
            "genres": {},
            "associations": {},
        },
        "extended": {"listofdlc": ""},
        "config": {},
        "depots": {},
    }
    return validate_pics_product_payload(
        appid=7,
        claimed_through_change_number=20,
        raw_payload=raw,
    )


def make_claim():
    return PICSWorkClaim(
        id=41,
        appid=7,
        stream_key="primary",
        work_mode="durable",
        lane="live",
        priority=200,
        claimed_through_change_number=20,
        attempts=1,
        max_attempts=8,
        claim_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        worker_id="worker-1",
    )


def make_reconciliation_claim():
    return PICSWorkClaim(
        id=42,
        appid=7,
        stream_key="primary",
        work_mode="durable",
        lane="catchup",
        priority=100,
        claimed_through_change_number=0,
        attempts=1,
        max_attempts=8,
        claim_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        worker_id="worker-1",
        reconciliation_run_id=UUID("11111111-1111-4111-8111-111111111111"),
    )


def make_reconciliation_payload():
    raw = {
        "appid": 7,
        "_change_number": 20,
        "_missing_token": False,
        "_sha": "a" * 40,
        "_size": 100,
        "common": {
            "name": "Test app",
            "type": "game",
            "category": {},
            "genres": {},
            "store_tags": {},
            "associations": {},
        },
        "extended": {"listofdlc": ""},
        "config": {},
        "depots": {},
    }
    return validate_pics_product_payload(
        appid=7,
        claimed_through_change_number=0,
        raw_payload=raw,
    )


class FakeCursor(AbstractContextManager):
    def __init__(self, *, fail_on=None):
        self.fail_on = fail_on
        self.events = []
        self.rowcount = 0
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.events.append((normalized, params))
        if self.fail_on and self.fail_on in normalized:
            raise RuntimeError("injected promotion failure")
        self.rowcount = 0
        self._row = None
        if normalized.startswith("SELECT attempts, max_attempts"):
            self._row = (1, 8)
        elif normalized.startswith("SELECT id, content_hash"):
            self._row = None
        elif normalized.startswith("INSERT INTO docs.app_source_snapshots"):
            self._row = (100,)
            self.rowcount = 1
        elif "UPDATE legacy.apps app" in normalized:
            self.rowcount = 1
        elif "RETURNING state" in normalized:
            self._row = ("completed",)
            self.rowcount = 1
        elif normalized.startswith("UPDATE ops.pics_reconciliation_items"):
            self.rowcount = 1

    def fetchone(self):
        return self._row


class FakeTransaction(AbstractContextManager):
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is None:
            self.connection.committed = True
        else:
            self.connection.rolled_back = True
        return False


class FakeConnection(AbstractContextManager):
    def __init__(self, cursor):
        self.cursor_instance = cursor
        self.committed = False
        self.rolled_back = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def transaction(self):
        return FakeTransaction(self)

    def cursor(self):
        return self.cursor_instance


def make_promoter(cursor):
    connection = FakeConnection(cursor)
    work_store = TigerPICSDurableWorkStore("postgresql://unused")
    promoter = TigerPICSDurablePromoter(
        "",
        work_store,
        connection_factory=lambda: connection,
    )
    return promoter, connection


def archive_pointer():
    return ArchivePointer(
        bucket="test-bucket",
        byte_size=100,
        content_hash="b" * 64,
        content_type="application/json",
        key="test/payload.json",
    )


def test_promotion_commits_snapshot_latest_state_readiness_and_ack_together():
    cursor = FakeCursor()
    promoter, connection = make_promoter(cursor)

    result = promoter.promote(
        claim=make_claim(),
        worker_id="worker-1",
        payload=make_payload(),
        previous_pointer=None,
        previous_snapshot=None,
        archive=archive_pointer(),
    )

    statements = [statement for statement, _ in cursor.events]
    snapshot_index = next(
        i
        for i, statement in enumerate(statements)
        if statement.startswith("INSERT INTO docs.app_source_snapshots")
    )
    latest_index = next(
        i for i, statement in enumerate(statements) if "UPDATE legacy.apps app" in statement
    )
    readiness_index = next(
        i
        for i, statement in enumerate(statements)
        if statement.startswith("INSERT INTO ops.app_data_readiness")
    )
    acknowledgement_index = next(
        i for i, statement in enumerate(statements) if "RETURNING state" in statement
    )
    assert snapshot_index < latest_index < readiness_index < acknowledgement_index
    assert result.snapshot_id == 100
    assert result.snapshot_changed is True
    assert result.next_work_state == "completed"
    assert connection.committed is True
    assert connection.rolled_back is False


def test_absent_relationship_family_never_deletes_existing_edges():
    cursor = FakeCursor()
    promoter, connection = make_promoter(cursor)

    promoter.promote(
        claim=make_claim(),
        worker_id="worker-1",
        payload=make_payload_with_absent_tags(),
        previous_pointer=None,
        previous_snapshot=None,
        archive=archive_pointer(),
    )

    statements = [statement for statement, _ in cursor.events]
    assert not any(
        statement.startswith("DELETE FROM legacy.app_steam_tags") for statement in statements
    )
    assert connection.committed is True


def test_full_reconciliation_promotes_with_actual_payload_change_evidence():
    cursor = FakeCursor()
    promoter, connection = make_promoter(cursor)

    result = promoter.promote(
        claim=make_reconciliation_claim(),
        worker_id="worker-1",
        payload=make_reconciliation_payload(),
        previous_pointer=None,
        previous_snapshot=None,
        archive=archive_pointer(),
    )

    snapshot = next(
        params
        for statement, params in cursor.events
        if statement.startswith("INSERT INTO docs.app_source_snapshots")
    )
    sync_status = next(
        params
        for statement, params in cursor.events
        if statement.startswith("INSERT INTO ops.sync_status")
    )
    settlement = next(
        params
        for statement, params in cursor.events
        if statement.startswith("UPDATE ops.pics_reconciliation_items")
    )

    assert snapshot[6:8] == ("full_state_reconciliation", "20")
    assert sync_status == (7, 20)
    assert settlement[0:2] == (100, 20)
    assert result.completed_through_change_number == 0
    assert connection.committed is True


def test_pics_event_writes_resolve_the_shared_tiger_registry_version():
    cursor = FakeCursor()

    inserted = TigerPICSDurablePromoter._insert_events(
        cursor,
        claim=make_claim(),
        snapshot_id=100,
        source_change_number=20,
        previous_pointer=None,
        archive=archive_pointer(),
        events=[
            SimpleNamespace(
                change_type="tags_added",
                before_value=[],
                after_value=["Action"],
                context={"added": ["Action"]},
            )
        ],
        observed_at=datetime.now(timezone.utc),
    )

    statement = cursor.events[-1][0]
    assert inserted == 0
    assert "events.resolve_change_event_v1" in statement
    assert "'event_registry_version', registry.registry_version" in statement
    assert "'signal_family', registry.signal_family" in statement


@pytest.mark.parametrize(
    "failure_boundary",
    [
        "INSERT INTO docs.app_source_snapshots",
        "UPDATE legacy.apps app",
        "DELETE FROM legacy.app_categories",
        "INSERT INTO ops.sync_status",
        "INSERT INTO ops.app_data_readiness",
        "RETURNING state",
    ],
)
def test_every_promotion_failure_boundary_rolls_back(failure_boundary):
    cursor = FakeCursor(fail_on=failure_boundary)
    promoter, connection = make_promoter(cursor)

    with pytest.raises(RuntimeError, match="injected promotion failure"):
        promoter.promote(
            claim=make_claim(),
            worker_id="worker-1",
            payload=make_payload(),
            previous_pointer=None,
            previous_snapshot=None,
            archive=archive_pointer(),
        )

    assert connection.committed is False
    assert connection.rolled_back is True
