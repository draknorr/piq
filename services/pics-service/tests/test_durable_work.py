from contextlib import AbstractContextManager
from datetime import datetime, timedelta, timezone

import pytest

from src.config.settings import Settings
from src.database.durable_work import (
    PICSWorkClaim,
    PICSWorkStateError,
    TigerPICSDurableWorkStore,
)


class FakeCursor(AbstractContextManager):
    def __init__(self, *, fail_on=None):
        self.fail_on = fail_on
        self.events = []
        self.rowcount = 0
        self._rows = []
        self._row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.events.append((normalized, params))
        if self.fail_on and self.fail_on in normalized:
            raise RuntimeError("injected work-state failure")
        self.rowcount = 0
        self._rows = []
        self._row = None
        if normalized.startswith("WITH candidates AS"):
            self._rows = [
                {
                    "id": 41,
                    "appid": 7,
                    "stream_key": "shadow-test",
                    "work_mode": "shadow",
                    "lane": "live",
                    "priority": 200,
                    "claimed_through_change_number": 20,
                    "attempts": 2,
                    "max_attempts": 8,
                    "claim_expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
                    "worker_id": "worker-1",
                }
            ]
            self.rowcount = 1
        elif normalized.startswith("UPDATE ops.pics_work_state SET heartbeat_at"):
            self.rowcount = len(params[1])
        elif normalized.startswith("SELECT attempts, max_attempts"):
            self._row = (2, 8)
        elif normalized.startswith("SELECT id, content_hash"):
            self._row = (100, "a" * 64, "test-bucket", "test/key.json", "b" * 64)
        elif "RETURNING state" in normalized:
            self._row = ("completed",)
            self.rowcount = 1

    def fetchall(self):
        return self._rows

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

    def cursor(self, **_kwargs):
        return self.cursor_instance


def make_store(cursor):
    connection = FakeConnection(cursor)
    return (
        TigerPICSDurableWorkStore("", connection_factory=lambda: connection),
        connection,
    )


def make_claim():
    return PICSWorkClaim(
        id=41,
        appid=7,
        stream_key="shadow-test",
        work_mode="shadow",
        lane="live",
        priority=200,
        claimed_through_change_number=20,
        attempts=2,
        max_attempts=8,
        claim_expires_at=datetime.now(timezone.utc) + timedelta(minutes=5),
        worker_id="worker-1",
    )


def test_processing_defaults_fail_closed():
    assert Settings.model_fields["pics_processing_enabled"].default is False


def test_claim_recovers_expired_leases_before_skip_locked_claim():
    cursor = FakeCursor()
    store, connection = make_store(cursor)

    claims = store.claim_work(
        work_mode="shadow",
        stream_key="shadow-test",
        worker_id="worker-1",
        lane_group="live",
        limit=10,
        lease_seconds=300,
    )

    statements = [statement for statement, _ in cursor.events]
    recovery_index = next(
        index
        for index, statement in enumerate(statements)
        if "last_error_code = 'lease_expired'" in statement
    )
    claim_index = next(
        index
        for index, statement in enumerate(statements)
        if statement.startswith("WITH candidates AS")
    )
    assert recovery_index < claim_index
    assert "FOR UPDATE OF work SKIP LOCKED" in statements[claim_index]
    assert claims[0].claimed_through_change_number == 20
    assert claims[0].attempts == 2
    assert connection.committed is True


def test_claim_failure_rolls_back_the_recovery_and_claim_transaction():
    cursor = FakeCursor(fail_on="WITH candidates AS")
    store, connection = make_store(cursor)

    with pytest.raises(RuntimeError, match="injected work-state failure"):
        store.claim_work(
            work_mode="shadow",
            stream_key="shadow-test",
            worker_id="worker-1",
            lane_group="live",
            limit=10,
            lease_seconds=300,
        )

    assert connection.committed is False
    assert connection.rolled_back is True


def test_heartbeat_only_extends_owned_unexpired_claims():
    cursor = FakeCursor()
    store, _connection = make_store(cursor)

    updated = store.heartbeat_claims(
        claims=[make_claim()],
        worker_id="worker-1",
        lease_seconds=300,
    )

    assert updated == 1
    statement = next(
        statement
        for statement, _ in cursor.events
        if statement.startswith("UPDATE ops.pics_work_state SET heartbeat_at")
    )
    assert "claim_expires_at > clock_timestamp()" in statement
    assert "worker_id = %s" in statement


def test_retry_clears_lease_and_uses_bounded_next_attempt():
    cursor = FakeCursor()
    store, connection = make_store(cursor)

    state = store.fail_claim(
        claim=make_claim(),
        worker_id="worker-1",
        error_code="network",
        error_message="temporary",
        retryable=True,
        retry_delay_seconds=30,
    )

    assert state == "retrying"
    update = next(
        (statement, params)
        for statement, params in cursor.events
        if statement.startswith("UPDATE ops.pics_work_state SET state = %s")
    )
    assert "claimed_through_change_number = NULL" in update[0]
    assert update[1][0] == "retrying"
    assert update[1][1] is True
    assert connection.committed is True


def test_lost_claim_fails_closed_before_acknowledgement():
    cursor = FakeCursor()
    cursor.execute = lambda query, params=None: cursor.events.append(
        (" ".join(query.split()), params)
    )
    store, connection = make_store(cursor)

    with pytest.raises(PICSWorkStateError, match="no longer owned"):
        store.complete_shadow_claim(
            claim=make_claim(),
            worker_id="worker-1",
        )

    assert connection.rolled_back is True


def test_latest_snapshot_read_uses_transaction_local_timeouts():
    cursor = FakeCursor()
    store, connection = make_store(cursor)

    snapshot = store.get_latest_snapshot(7)

    statements = [statement for statement, _ in cursor.events]
    assert statements[0].startswith("SELECT set_config('statement_timeout'")
    assert statements[1].startswith("SELECT set_config('lock_timeout'")
    assert statements[2].startswith("SELECT id, content_hash")
    assert snapshot is not None
    assert snapshot.id == 100
    assert connection.committed is True
