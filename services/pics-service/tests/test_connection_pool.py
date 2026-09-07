"""Wrapper guarantees; actual PostgreSQL fault/concurrency tests live in assessment evidence."""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.connection_pool import PICSConnectionPool  # noqa: E402


@pytest.mark.parametrize("size", [0, 9])
def test_pool_rejects_unbounded_sizes(size):
    with pytest.raises(ValueError, match="between 1 and 8"):
        PICSConnectionPool("unused", application_name="fixture", max_size=size)


def test_pool_opens_lazily_with_fixed_bounds_and_reuses_the_owner(monkeypatch):
    import psycopg_pool

    created = []

    class FakePool:
        check_connection = staticmethod(lambda _connection: None)

        def __init__(self, url, **kwargs):
            self.url = url
            self.kwargs = kwargs
            self.closed = False
            self.owner = SimpleNamespace(closed=False)
            created.append(self)

        def getconn(self, timeout):
            assert timeout == 10
            return self.owner

        def putconn(self, connection):
            assert connection is self.owner

        def get_stats(self):
            return {"pool_size": 1}

        def close(self, timeout):
            assert timeout == 5
            self.closed = True

    monkeypatch.setattr(psycopg_pool, "ConnectionPool", FakePool)
    owner = PICSConnectionPool("unused", application_name="fixture", max_size=2)
    assert owner.get_stats() == {}
    assert created == []
    first = owner._get_pool()
    second = owner._get_pool()
    assert first is second
    assert len(created) == 1
    kwargs = created[0].kwargs
    assert (kwargs["min_size"], kwargs["max_size"], kwargs["max_waiting"]) == (0, 2, 16)
    assert kwargs["kwargs"]["connect_timeout"] == 10
    assert kwargs["kwargs"]["prepare_threshold"] is None
    assert kwargs["max_idle"] == 300
    assert owner.get_stats() == {"pool_size": 1}
    owner.close()
    owner.close()
    assert created[0].closed
    with pytest.raises(RuntimeError, match="closed"):
        with owner.connection():
            pass


def test_reset_clears_server_state_then_restores_driver_and_timeout_defaults():
    calls = []
    connection = SimpleNamespace(
        autocommit=False,
        isolation_level="serializable",
        read_only=True,
        deferrable=True,
        row_factory="changed",
    )

    def execute(sql, *args, **kwargs):
        assert connection.autocommit is True
        calls.append((sql, args, kwargs))

    connection.execute = execute
    owner = PICSConnectionPool("unused", application_name="fixture", max_size=1)
    owner._reset(connection)
    assert calls[0] == ("DISCARD ALL", (), {"prepare": False})
    assert calls[1][1] == (("60000", "10000", "fixture"),)
    assert connection.autocommit is False
    assert connection.isolation_level is None
    assert connection.read_only is None
    assert connection.deferrable is None
    from psycopg.rows import tuple_row

    assert connection.row_factory is tuple_row


def test_failed_reset_propagates_for_pool_discard_and_restores_autocommit():
    connection = SimpleNamespace(autocommit=False)

    def fail(*_args, **_kwargs):
        raise RuntimeError("reset failed")

    connection.execute = fail
    owner = PICSConnectionPool("unused", application_name="fixture", max_size=1)
    with pytest.raises(RuntimeError, match="reset failed"):
        owner._reset(connection)
    assert connection.autocommit is False


def test_closing_unused_pool_does_not_open_a_connection():
    owner = PICSConnectionPool("unused", application_name="fixture", max_size=1)
    owner.close()
    assert owner.get_stats() == {}
    with pytest.raises(RuntimeError, match="closed"):
        owner._get_pool()


@pytest.mark.parametrize("body_fails", [False, True])
def test_failed_return_reset_closes_connection_without_masking_transaction_outcome(body_fails):
    events = []

    class Connection:
        closed = False

        def __enter__(self):
            return self

        def __exit__(self, error_type, *_args):
            events.append("rollback" if error_type else "commit")

        def close(self):
            self.closed = True
            events.append("close")

    connection = Connection()
    fake_pool = SimpleNamespace(
        getconn=lambda **_kwargs: connection,
        putconn=lambda returned: events.append(
            "return_closed" if returned.closed else "return_open"
        ),
    )
    owner = PICSConnectionPool("unused", application_name="fixture", max_size=1)
    owner._get_pool = lambda: fake_pool

    def fail_reset(_connection):
        events.append("reset")
        raise RuntimeError("reset failed")

    owner._reset = fail_reset

    def run():
        with owner.connection():
            if body_fails:
                raise ValueError("body failed")

    if body_fails:
        with pytest.raises(ValueError, match="body failed"):
            run()
    else:
        run()
    assert events == ["rollback" if body_fails else "commit", "reset", "close", "return_closed"]
