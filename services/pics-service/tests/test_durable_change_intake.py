# ruff: noqa: E402, I001

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from uuid import UUID

import pytest
import gevent
from gevent.event import Event

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

fake_client_module = ModuleType("src.steam.client")
fake_client_module.PICSSteamClient = object
sys.modules.setdefault("src.steam.client", fake_client_module)

fake_pics_module = ModuleType("src.steam.pics")
fake_pics_module.PICSFetcher = object
fake_pics_module.PICSChange = object
sys.modules.setdefault("src.steam.pics", fake_pics_module)

from src.database.durable_intake import (  # noqa: E402
    PICSArchiveReference,
    PICSSourceAppChange,
    PersistedPICSBatch,
    hash_pics_app_changes,
)
from src.database.tiger_change_history import ArchivePointer  # noqa: E402
from src.workers.durable_change_intake import (  # noqa: E402
    DurableChangeIntakeWorker,
    IncompletePICSChangeResponseError,
)


class FakeFetcher:
    def __init__(
        self,
        change_number,
        app_changes,
        *,
        response_since=10,
        force_full_update=False,
        force_full_app_update=False,
        force_full_package_update=False,
    ):
        self.change_number = change_number
        self.app_changes = app_changes
        self.response_since = response_since
        self.force_full_update = force_full_update
        self.force_full_app_update = force_full_app_update
        self.force_full_package_update = force_full_package_update

    def get_changes_since(self, _last_change):
        return SimpleNamespace(
            change_number=self.change_number,
            app_changes=[change.appid for change in self.app_changes],
            app_change_details=self.app_changes,
            package_changes=[],
            since_change_number=self.response_since,
            force_full_update=self.force_full_update,
            force_full_app_update=self.force_full_app_update,
            force_full_package_update=self.force_full_package_update,
        )


class FakeStore:
    def __init__(self, *, error=None):
        self.error = error
        self.calls = []

    def persist_batch(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        app_changes = kwargs["app_changes"]
        source_complete = (
            kwargs["response_since_change_number"] == kwargs["from_change_number"]
            and not kwargs["force_full_update"]
            and not kwargs["force_full_app_update"]
        )
        return PersistedPICSBatch(
            batch_id=UUID("22222222-2222-4222-8222-222222222222"),
            stream_key=kwargs["stream_key"],
            work_mode=kwargs["work_mode"],
            lane=kwargs["lane"],
            from_change_number=kwargs["from_change_number"],
            to_change_number=kwargs["to_change_number"],
            response_since_change_number=kwargs["response_since_change_number"],
            source_app_count=len(app_changes),
            distinct_app_count=len({change.appid for change in app_changes}),
            durable_app_count=len(app_changes),
            app_changes_sha256=hash_pics_app_changes(app_changes),
            force_full_update=kwargs["force_full_update"],
            force_full_app_update=kwargs["force_full_app_update"],
            force_full_package_update=kwargs["force_full_package_update"],
            source_complete=source_complete,
            status="committed" if source_complete else "source_blocked",
            primary_cursor_advanced=(kwargs["work_mode"] == "durable" and source_complete),
            idempotent_replay=False,
        )


class FakeArchiveStore:
    def __init__(self, *, error=None):
        self.error = error
        self.calls = []
        self.pointer = ArchivePointer(
            bucket="pics-archive",
            key="pics-change-response/test.json",
            content_hash="b" * 64,
            byte_size=456,
            content_type="application/json",
        )

    def write_json(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.pointer


def make_worker(store, archive_store=None):
    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._work_mode = "shadow"
    worker._stream_key = "replay-test"
    worker._lane = "live"
    worker._fetcher = FakeFetcher(
        20,
        [
            PICSSourceAppChange(7, 11, False),
            PICSSourceAppChange(9, 20, True),
        ],
    )
    worker._store = store
    worker._archive_store = archive_store or FakeArchiveStore()
    worker._last_committed_batch = None
    return worker


def test_intake_commits_while_one_processing_pass_waits_without_starting_another():
    store = FakeStore()
    worker = make_worker(store)
    gate = Event()
    calls = []

    def process_once(fetcher):
        calls.append(fetcher)
        gate.wait()
        return "settled"

    worker._processor = SimpleNamespace(process_once=process_once)
    worker._processing_job = None
    worker._next_processing_at_monotonic = 0
    worker._consecutive_processing_failures = 0
    worker._last_processing_error = None
    worker._process_once_if_due()
    assert worker._processing_job is not None and not worker._processing_job.ready()
    worker._next_processing_at_monotonic = 0
    worker._process_once_if_due()
    assert worker.poll_once(10) == 20
    assert len(store.calls) == 1 and len(calls) == 1
    gate.set()
    worker._processing_job.join(timeout=1)
    worker._process_once_if_due()
    assert worker._last_processing_stats == "settled"
    assert worker._processing_job is None


def test_native_archive_wait_yields_without_advancing_cursor_before_persistence():
    import time

    store = FakeStore()
    archive = FakeArchiveStore()
    original = archive.write_json
    ticks = []

    def slow_archive(**kwargs):
        time.sleep(0.03)
        assert store.calls == []
        return original(**kwargs)

    archive.write_json = slow_archive
    worker = make_worker(store, archive)
    ticker = gevent.spawn_later(0.005, lambda: ticks.append("hub progressed"))
    assert worker.poll_once(10) == 20
    ticker.join(timeout=1)
    assert ticks == ["hub progressed"]
    assert len(store.calls) == 1


def test_poll_once_returns_later_cursor_only_after_store_commit():
    store = FakeStore()
    worker = make_worker(store)

    assert worker.poll_once(10) == 20
    expected_archive = PICSArchiveReference(
        bucket=worker._archive_store.pointer.bucket,
        key=worker._archive_store.pointer.key,
        content_hash=worker._archive_store.pointer.content_hash,
        byte_size=worker._archive_store.pointer.byte_size,
        content_type=worker._archive_store.pointer.content_type,
    )
    assert store.calls == [
        {
            "archive": expected_archive,
            "from_change_number": 10,
            "to_change_number": 20,
            "response_since_change_number": 10,
            "app_changes": [
                PICSSourceAppChange(7, 11, False),
                PICSSourceAppChange(9, 20, True),
            ],
            "force_full_update": False,
            "force_full_app_update": False,
            "force_full_package_update": False,
            "work_mode": "shadow",
            "stream_key": "replay-test",
            "lane": "live",
        }
    ]
    archive_call = worker._archive_store.calls[0]
    assert archive_call["kind"] == "pics-change-response"
    assert archive_call["content_hash"] is None
    assert archive_call["payload"] == {
        "_archive_schema_version": "pics-change-response/v2",
        "stream_key": "replay-test",
        "work_mode": "shadow",
        "lane": "live",
        "from_change_number": 10,
        "to_change_number": 20,
        "response_since_change_number": 10,
        "source_app_count": 2,
        "distinct_app_count": 2,
        "app_changes_sha256": hash_pics_app_changes(
            [
                PICSSourceAppChange(7, 11, False),
                PICSSourceAppChange(9, 20, True),
            ]
        ),
        "force_full_update": False,
        "force_full_app_update": False,
        "force_full_package_update": False,
        "app_changes": [
            {
                "source_index": 0,
                "appid": 7,
                "change_number": 11,
                "needs_token": False,
            },
            {
                "source_index": 1,
                "appid": 9,
                "change_number": 20,
                "needs_token": True,
            },
        ],
        "package_changes": [],
    }
    assert worker._last_committed_batch.to_change_number == 20
    assert worker._last_intake_phase_seconds["steam_change_poll_requests"] == 1
    assert "steam_change_poll" in worker._last_intake_phase_seconds
    assert "r2_change_archive" in worker._last_intake_phase_seconds
    assert "tiger_batch_persist" in worker._last_intake_phase_seconds


def test_poll_once_does_not_return_a_later_cursor_when_persistence_fails():
    store = FakeStore(error=RuntimeError("database unavailable"))
    worker = make_worker(store)

    with pytest.raises(RuntimeError, match="database unavailable"):
        worker.poll_once(10)

    assert worker._last_committed_batch is None


def test_poll_once_does_not_persist_or_advance_when_archive_fails():
    store = FakeStore()
    archive_store = FakeArchiveStore(error=RuntimeError("archive unavailable"))
    worker = make_worker(store, archive_store)

    with pytest.raises(RuntimeError, match="archive unavailable"):
        worker.poll_once(10)

    assert len(archive_store.calls) == 1
    assert store.calls == []
    assert worker._last_committed_batch is None


def test_poll_once_ignores_nonadvancing_source_response():
    store = FakeStore()
    worker = make_worker(store)
    worker._fetcher = FakeFetcher(
        10,
        [PICSSourceAppChange(7, 10, False)],
    )

    assert worker.poll_once(10) == 10
    assert store.calls == []


def test_poll_once_retains_force_full_response_without_advancing_cursor():
    store = FakeStore()
    worker = make_worker(store)
    worker._fetcher = FakeFetcher(
        20,
        [PICSSourceAppChange(7, 11, False)],
        force_full_app_update=True,
    )

    with pytest.raises(IncompletePICSChangeResponseError, match="source_blocked"):
        worker.poll_once(10)

    assert len(store.calls) == 1
    assert worker._last_committed_batch.source_complete is False
    assert worker._last_committed_batch.primary_cursor_advanced is False


def test_processing_cadence_guard_uses_monotonic_deadline():
    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._next_processing_at_monotonic = 215.0

    assert worker._processing_due(214.999) is False
    assert worker._processing_due(215.0) is True


def test_run_processes_due_work_while_incremental_intake_is_source_blocked(monkeypatch):
    class FakeSteam:
        is_connected = True

        def set_heartbeat_interval(self, _value):
            pass

        def set_auto_reconnect(self, _value):
            pass

        def connect(self):
            return True

        def disconnect(self):
            pass

    class StartCursorStore:
        def get_start_change_number(self, **_kwargs):
            return 10

    class FakeProcessor:
        worker_id = "test-worker"

        def __init__(self):
            self.calls = []

        def process_once(self, fetcher):
            self.calls.append(fetcher)
            return None

    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._work_mode = "durable"
    worker._stream_key = "primary"
    worker._steam = FakeSteam()
    worker._store = StartCursorStore()
    worker._health = None
    worker._fetcher = None
    worker._processor = FakeProcessor()
    worker._running = False
    worker._consecutive_poll_failures = 0
    worker._last_poll_error = None
    worker._consecutive_processing_failures = 0
    worker._last_processing_error = None
    worker._last_successful_change_poll_at = None
    worker._last_committed_batch = None
    worker._last_processing_stats = None
    worker._last_processing_started_at = None
    worker._next_processing_at_monotonic = 0.0
    worker._last_intake_phase_seconds = {}
    worker._processing_job = None

    fetcher = object()
    monkeypatch.setattr(
        "src.workers.durable_change_intake.PICSFetcher",
        lambda *_args, **_kwargs: fetcher,
    )
    monkeypatch.setattr(
        worker,
        "poll_once",
        lambda _last_change: (_ for _ in ()).throw(
            IncompletePICSChangeResponseError("source_blocked")
        ),
    )
    monkeypatch.setattr(
        "src.workers.durable_change_intake.gevent.sleep",
        lambda _seconds: setattr(worker, "_running", False),
    )

    worker.run()

    assert worker._processor.calls == [fetcher]
    assert worker._consecutive_poll_failures == 1
    assert worker._last_poll_error == "source_blocked"
    assert worker._consecutive_processing_failures == 0


@pytest.mark.parametrize("phase", ["poll", "processing"])
@pytest.mark.parametrize(
    "error_name", ["LockNotAvailable", "DeadlockDetected", "SerializationFailure"]
)
def test_transaction_contention_recovers_beyond_restart_threshold(monkeypatch, phase, error_name):
    from psycopg import errors

    worker, observed, sleeps = make_retry_loop_worker(monkeypatch)
    failures = 7
    attempts = []

    def operation(cursor=None):
        attempts.append(cursor)
        if len(attempts) <= failures:
            raise getattr(errors, error_name)("temporary transaction contention")
        if phase == "poll":
            return 20
        worker._consecutive_processing_failures = 0
        worker._last_processing_error = None

    if phase == "poll":
        worker.poll_once = operation
    else:
        worker._process_once_if_due = operation

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == failures + 1:
            worker._running = False

    monkeypatch.setattr("src.workers.durable_change_intake.gevent.sleep", sleep)
    worker.run()

    assert len(attempts) == failures + 1
    assert all(state["cursor"] == 10 for state in observed[:-1])
    assert observed[-1]["cursor"] == (20 if phase == "poll" else 10)
    assert all(state["forced_state"] is None for state in observed)
    assert getattr(worker, f"_consecutive_{phase}_failures") == 0
    assert getattr(worker, f"_last_{phase}_error") is None
    assert all(0 < seconds <= 300 for seconds in sleeps)
    if phase == "poll":
        assert attempts == [10] * (failures + 1)
        assert sleeps[:7] == [30, 60, 120, 240, 300, 300, 300]


@pytest.mark.parametrize("phase", ["poll", "processing"])
def test_unexpected_errors_still_exit_after_three_failures(monkeypatch, phase):
    worker, observed, _sleeps = make_retry_loop_worker(monkeypatch)

    def fail(*_args):
        raise ValueError("invalid invariant")

    if phase == "poll":
        worker.poll_once = fail
    else:
        worker._process_once_if_due = fail
    monkeypatch.setattr("src.workers.durable_change_intake.gevent.sleep", lambda _seconds: None)

    with pytest.raises(RuntimeError, match="Exceeded consecutive durable PICS"):
        worker.run()
    assert observed[-1]["forced_state"] == "unhealthy"
    assert getattr(worker, f"_consecutive_{phase}_failures") == 3


def make_retry_loop_worker(monkeypatch):
    from src.config.settings import settings

    monkeypatch.setattr(settings, "poll_interval", 30)
    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._work_mode = "durable"
    worker._stream_key = "primary"
    worker._steam = SimpleNamespace(
        set_heartbeat_interval=lambda _value: None,
        set_auto_reconnect=lambda _value: None,
        connect=lambda: True,
        disconnect=lambda: None,
    )
    worker._store = SimpleNamespace(get_start_change_number=lambda **_kwargs: 10)
    worker._processor = None
    worker._processing_job = None
    worker._consecutive_poll_failures = 0
    worker._last_poll_error = None
    worker._consecutive_processing_failures = 0
    worker._last_processing_error = None
    worker.poll_once = lambda cursor: cursor
    worker._process_once_if_due = lambda: None
    observed = []
    sleeps = []
    worker._update_health_status = lambda cursor, forced_state=None: observed.append(
        {"cursor": cursor, "forced_state": forced_state}
    )
    monkeypatch.setattr(
        "src.workers.durable_change_intake.PICSFetcher", lambda *_a, **_kw: object()
    )
    return worker, observed, sleeps
