from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import UUID

import pytest

from src.database.durable_payload import validate_pics_product_payload
from src.database.durable_promotion import TigerPICSDurablePromoter
from src.database.durable_work import PICSWorkClaim, TigerPICSDurableWorkStore
from src.database.tiger_change_history import ArchivePointer
from src.database.tiger_latest_state import (
    TigerPICSLatestStateStore,
    resolve_tiger_franchise_id,
)


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


def make_payload_with_franchise(franchise_name="Defender's  Quest"):
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
            "associations": {
                "0": {
                    "type": "franchise",
                    "name": franchise_name,
                }
            },
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
    def __init__(
        self,
        *,
        fail_on=None,
        franchise_exact_id=None,
        franchise_normalized_id=None,
        franchise_insert_id=None,
        franchise_post_conflict_id=None,
    ):
        self.fail_on = fail_on
        self.franchise_exact_id = franchise_exact_id
        self.franchise_normalized_id = franchise_normalized_id
        self.franchise_insert_id = franchise_insert_id
        self.franchise_post_conflict_id = franchise_post_conflict_id
        self.franchise_insert_attempted = False
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
        elif normalized.startswith("SELECT id FROM legacy.franchises WHERE name = %s"):
            if self.franchise_exact_id is not None:
                self._row = (self.franchise_exact_id,)
        elif normalized.startswith("SELECT id FROM legacy.franchises WHERE normalized_name = %s"):
            franchise_id = (
                self.franchise_post_conflict_id
                if self.franchise_insert_attempted and self.franchise_post_conflict_id is not None
                else self.franchise_normalized_id
            )
            if franchise_id is not None:
                self._row = (franchise_id,)
        elif normalized.startswith("INSERT INTO legacy.franchises"):
            self.franchise_insert_attempted = True
            if self.franchise_insert_id is not None:
                self._row = (self.franchise_insert_id,)
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


def test_promotion_reuses_exact_franchise_name_with_legacy_normalization():
    cursor = FakeCursor(franchise_exact_id=1669)
    promoter, connection = make_promoter(cursor)

    promoter.promote(
        claim=make_claim(),
        worker_id="worker-1",
        payload=make_payload_with_franchise(),
        previous_pointer=None,
        previous_snapshot=None,
        archive=archive_pointer(),
    )

    statements = [statement for statement, _ in cursor.events]
    franchise_link = next(
        params
        for statement, params in cursor.events
        if statement.startswith("INSERT INTO legacy.app_franchises")
    )
    exact_lookup_index = statements.index(
        "SELECT id FROM legacy.franchises WHERE name = %s LIMIT 1"
    )
    link_index = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("INSERT INTO legacy.app_franchises")
    )
    assert exact_lookup_index < link_index
    assert not any(
        statement.startswith("INSERT INTO legacy.franchises") for statement in statements
    )
    assert franchise_link == (7, 1669)
    assert connection.committed is True


def test_franchise_resolution_prefers_exact_name_over_normalized_match():
    cursor = FakeCursor(
        franchise_exact_id=248260,
        franchise_normalized_id=1790,
    )

    franchise_id = resolve_tiger_franchise_id(cursor, "Dying  Light")

    statements = [statement for statement, _ in cursor.events]
    assert franchise_id == 248260
    assert statements == ["SELECT id FROM legacy.franchises WHERE name = %s LIMIT 1"]


def test_franchise_resolution_reuses_normalized_identity_without_renaming():
    cursor = FakeCursor(franchise_normalized_id=1790)

    franchise_id = resolve_tiger_franchise_id(cursor, "  DYING   LIGHT ")

    statements = [statement for statement, _ in cursor.events]
    assert franchise_id == 1790
    assert statements == [
        "SELECT id FROM legacy.franchises WHERE name = %s LIMIT 1",
        "SELECT id FROM legacy.franchises WHERE normalized_name = %s LIMIT 1",
    ]


def test_franchise_resolution_inserts_only_when_identity_is_new():
    cursor = FakeCursor(franchise_insert_id=250000)

    franchise_id = resolve_tiger_franchise_id(cursor, "New  Franchise")

    insert = next(
        (statement, params)
        for statement, params in cursor.events
        if statement.startswith("INSERT INTO legacy.franchises")
    )
    assert franchise_id == 250000
    assert "ON CONFLICT DO NOTHING" in insert[0]
    assert insert[1] == ("New  Franchise", "new franchise")


def test_franchise_resolution_recovers_from_concurrent_unique_conflict():
    cursor = FakeCursor(franchise_post_conflict_id=6302)

    franchise_id = resolve_tiger_franchise_id(cursor, "Movavi Software")

    statements = [statement for statement, _ in cursor.events]
    insert_statement = next(
        statement
        for statement in statements
        if statement.startswith("INSERT INTO legacy.franchises")
    )
    assert franchise_id == 6302
    assert "ON CONFLICT DO NOTHING" in insert_statement
    assert statements.count("SELECT id FROM legacy.franchises WHERE name = %s LIMIT 1") == 2


def test_tiger_latest_state_link_uses_shared_franchise_resolution():
    cursor = FakeCursor(franchise_exact_id=1669)
    connection = FakeConnection(cursor)
    store = TigerPICSLatestStateStore("postgresql://unused")
    store._connect = lambda: connection

    store.upsert_franchise_link(7, "Defender's  Quest")

    assert cursor.events[-1][1] == (7, 1669)
    assert not any(
        statement.startswith("INSERT INTO legacy.franchises") for statement, _ in cursor.events
    )


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
