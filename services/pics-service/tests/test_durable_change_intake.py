# ruff: noqa: E402, I001

import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from uuid import UUID

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

fake_client_module = ModuleType("src.steam.client")
fake_client_module.PICSSteamClient = object
sys.modules.setdefault("src.steam.client", fake_client_module)

fake_pics_module = ModuleType("src.steam.pics")
fake_pics_module.PICSFetcher = object
fake_pics_module.PICSChange = object
sys.modules.setdefault("src.steam.pics", fake_pics_module)

from src.database.durable_intake import (  # noqa: E402
    PICSSourceAppChange,
    PersistedPICSBatch,
    hash_pics_app_changes,
)
from src.workers.durable_change_intake import (  # noqa: E402
    DurableChangeIntakeWorker,
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


def make_worker(store):
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
    worker._last_committed_batch = None
    return worker


def test_poll_once_returns_later_cursor_only_after_store_commit():
    store = FakeStore()
    worker = make_worker(store)

    assert worker.poll_once(10) == 20
    assert store.calls == [
        {
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
    assert worker._last_committed_batch.to_change_number == 20


def test_poll_once_does_not_return_a_later_cursor_when_persistence_fails():
    store = FakeStore(error=RuntimeError("database unavailable"))
    worker = make_worker(store)

    with pytest.raises(RuntimeError, match="database unavailable"):
        worker.poll_once(10)

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

    with pytest.raises(RuntimeError, match="source_blocked"):
        worker.poll_once(10)

    assert len(store.calls) == 1
    assert worker._last_committed_batch.source_complete is False
    assert worker._last_committed_batch.primary_cursor_advanced is False
