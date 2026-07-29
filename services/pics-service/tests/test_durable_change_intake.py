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
    PICSArchiveReference,
    PICSSourceAppChange,
    PersistedPICSBatch,
    hash_pics_app_changes,
)
from src.database.tiger_change_history import ArchivePointer  # noqa: E402
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

    with pytest.raises(RuntimeError, match="source_blocked"):
        worker.poll_once(10)

    assert len(store.calls) == 1
    assert worker._last_committed_batch.source_complete is False
    assert worker._last_committed_batch.primary_cursor_advanced is False


def test_processing_cadence_guard_uses_monotonic_deadline():
    worker = DurableChangeIntakeWorker.__new__(DurableChangeIntakeWorker)
    worker._next_processing_at_monotonic = 215.0

    assert worker._processing_due(214.999) is False
    assert worker._processing_due(215.0) is True
