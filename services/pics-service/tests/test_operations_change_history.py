from __future__ import annotations

import os
from copy import deepcopy
from datetime import datetime
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import src.database.operations as operations_module
from src.database.change_intelligence import hash_normalized_snapshot, normalize_pics_snapshot
from src.database.operations import PICSDatabase
from src.extractors.common import Association, ExtractedPICSData, SteamDeckCompatibility


class FakeResult:
    def __init__(self, data: Optional[List[Dict[str, Any]]] = None):
        self.data = data or []


class FakeQuery:
    def __init__(self, client: "FakeSupabaseClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.action: Optional[str] = None
        self.payload: Any = None
        self.filters: List[tuple[str, str, Any]] = []
        self.orders: List[tuple[str, bool]] = []
        self._negated = False

    def select(self, columns: str) -> "FakeQuery":
        self.action = "select"
        self.columns = columns
        return self

    def insert(self, payload: Any) -> "FakeQuery":
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload: Dict[str, Any]) -> "FakeQuery":
        self.action = "update"
        self.payload = payload
        return self

    def upsert(self, payload: Any, on_conflict: Optional[str] = None) -> "FakeQuery":
        self.action = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def eq(self, key: str, value: Any) -> "FakeQuery":
        self.filters.append(("eq", key, value))
        return self

    def in_(self, key: str, value: List[Any]) -> "FakeQuery":
        self.filters.append(("in", key, list(value)))
        return self

    def order(self, key: str, desc: bool = False) -> "FakeQuery":
        self.orders.append((key, desc))
        return self

    @property
    def not_(self) -> "FakeQuery":
        self._negated = True
        return self

    def is_(self, key: str, value: Any) -> "FakeQuery":
        operator = "not_is" if self._negated else "is"
        self._negated = False
        self.filters.append((operator, key, value))
        return self

    def execute(self) -> FakeResult:
        return self.client.execute(self)


class FakeSupabaseClient:
    def __init__(
        self,
        snapshots: Optional[List[Dict[str, Any]]] = None,
        existing_appids: Optional[List[int]] = None,
        failures: Optional[Dict[tuple[str, str], List[Exception]]] = None,
    ):
        self.snapshots = deepcopy(snapshots or [])
        self.next_snapshot_id = max((int(row["id"]) for row in self.snapshots), default=0) + 1
        self.existing_appids = set(existing_appids or [])
        self.failures = {
            key: list(values)
            for key, values in (failures or {}).items()
        }
        self.inserted_events: List[Dict[str, Any]] = []
        self.snapshot_updates: List[Dict[str, Any]] = []
        self.apps_upserts: List[Dict[str, Any]] = []
        self.sync_status_upserts: List[Dict[str, Any]] = []
        self.calls: List[tuple[str, str]] = []

    def table(self, table_name: str) -> FakeQuery:
        return FakeQuery(self, table_name)

    def execute(self, query: FakeQuery) -> FakeResult:
        action = query.action or "unknown"
        self.calls.append((query.table_name, action))

        failure_queue = self.failures.get((query.table_name, action))
        if failure_queue:
            raise failure_queue.pop(0)

        if query.table_name == "app_source_snapshots":
            return self._execute_snapshots(query)
        if query.table_name == "app_change_events":
            rows = self._normalize_rows(query.payload)
            self.inserted_events.extend(deepcopy(rows))
            return FakeResult(rows)
        if query.table_name == "apps":
            if query.action == "select":
                appids = set(self._filter_value(query.filters, "in", "appid") or [])
                return FakeResult([{"appid": appid} for appid in sorted(appids & self.existing_appids)])
            rows = self._normalize_rows(query.payload)
            self.apps_upserts.extend(deepcopy(rows))
            return FakeResult(rows)
        if query.table_name == "sync_status":
            rows = self._normalize_rows(query.payload)
            self.sync_status_upserts.extend(deepcopy(rows))
            return FakeResult(rows)

        return FakeResult([])

    def _execute_snapshots(self, query: FakeQuery) -> FakeResult:
        if query.action == "select":
            appids = set(self._filter_value(query.filters, "in", "appid") or [])
            source = self._filter_value(query.filters, "eq", "source")
            rows = [
                deepcopy(row)
                for row in self.snapshots
                if row.get("appid") in appids and row.get("source") == source
            ]
            rows.sort(key=lambda row: (row["appid"], row.get("first_seen_at", "")), reverse=True)
            return FakeResult(rows)

        if query.action == "update":
            snapshot_id = self._filter_value(query.filters, "eq", "id")
            for row in self.snapshots:
                if row["id"] == snapshot_id:
                    row.update(deepcopy(query.payload))
                    self.snapshot_updates.append(deepcopy(row))
                    return FakeResult([deepcopy(row)])
            return FakeResult([])

        if query.action == "insert":
            self.next_snapshot_id = max(
                self.next_snapshot_id,
                max((int(row["id"]) for row in self.snapshots), default=0) + 1,
            )
            inserted_rows = []
            for row in self._normalize_rows(query.payload):
                inserted = deepcopy(row)
                inserted["id"] = self.next_snapshot_id
                self.next_snapshot_id += 1
                self.snapshots.append(inserted)
                inserted_rows.append(deepcopy(inserted))
            return FakeResult(inserted_rows)

        return FakeResult([])

    @staticmethod
    def _filter_value(filters: List[tuple[str, str, Any]], operator: str, key: str) -> Any:
        for current_operator, current_key, value in filters:
            if current_operator == operator and current_key == key:
                return value
        return None

    @staticmethod
    def _normalize_rows(payload: Any) -> List[Dict[str, Any]]:
        if payload is None:
            return []
        if isinstance(payload, list):
            return payload
        return [payload]


class FakeSupabaseWrapper:
    def __init__(self, client: FakeSupabaseClient):
        self.client = client


class FakeTigerHistoryStore:
    def __init__(self, latest_snapshots: Optional[Dict[int, Dict[str, Any]]] = None):
        self.latest_snapshots = deepcopy(latest_snapshots or {})
        self.inserted_snapshots: List[Dict[str, Any]] = []
        self.inserted_events: List[Dict[str, Any]] = []
        self.updated_snapshot_ids: List[int] = []
        self.updated_observed_at: Optional[str] = None
        self.next_id = 1000

    def get_latest_snapshots(self, appids: List[int]) -> Dict[int, Dict[str, Any]]:
        return {
            appid: deepcopy(self.latest_snapshots[appid])
            for appid in appids
            if appid in self.latest_snapshots
        }

    def update_last_seen_snapshots(self, snapshot_ids: List[int], observed_at: str) -> None:
        self.updated_snapshot_ids.extend(snapshot_ids)
        self.updated_observed_at = observed_at

    def insert_snapshots(self, snapshot_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        inserted = []
        for row in snapshot_rows:
            current = deepcopy(row)
            current["id"] = self.next_id
            self.next_id += 1
            self.inserted_snapshots.append(current)
            inserted.append({"appid": current["appid"], "id": current["id"]})
        return inserted

    def insert_change_events(self, event_rows: List[Dict[str, Any]]) -> None:
        self.inserted_events.extend(deepcopy(event_rows))


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: List[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def schema_cache_error() -> Exception:
    return Exception(
        {
            "message": "Could not find the table 'public.app_source_snapshots' in the schema cache",
            "code": "PGRST205",
            "hint": "Perhaps you meant the table 'public.ccu_snapshots'",
            "details": None,
        }
    )


def create_history_database(monkeypatch: pytest.MonkeyPatch, fake_client: FakeSupabaseClient) -> PICSDatabase:
    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "supabase")
    monkeypatch.setattr(operations_module.settings, "pics_latest_state_target", "supabase")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )
    return PICSDatabase()


def stub_latest_state_writes(monkeypatch: pytest.MonkeyPatch, database: PICSDatabase) -> None:
    monkeypatch.setattr(database, "_get_existing_appids", lambda appids: appids)
    monkeypatch.setattr(database, "_get_existing_app_names", lambda appids: {})
    monkeypatch.setattr(database, "_get_apps_with_storefront_dates", lambda appids: set())
    monkeypatch.setattr(database, "_get_apps_with_storefront_sync", lambda appids: set())
    monkeypatch.setattr(
        database,
        "_build_app_record",
        lambda app, has_storefront_date=False, has_storefront_sync=False, existing_name=None: {
            "appid": app.appid,
            "name": app.name or existing_name,
            "updated_at": datetime.utcnow().isoformat(),
        },
    )
    monkeypatch.setattr(database, "_sync_relationships", lambda apps, successful_appids, trigger_cursor=None: None)


def build_app(**overrides: Any) -> ExtractedPICSData:
    app = ExtractedPICSData(
        appid=730,
        name="Counter-Strike 2",
        type="game",
        developer="Valve",
        publisher="Valve",
        associations=[
            Association(type="developer", name="Valve"),
            Association(type="publisher", name="Valve"),
        ],
        dlc_appids=[100, 200],
        release_state="released",
        review_score=9,
        review_percentage=88,
        store_tags=[1, 2],
        genres=[1, 3],
        primary_genre=1,
        categories={2: True, 28: True},
        platforms=["windows", "linux"],
        controller_support="full",
        steam_deck=SteamDeckCompatibility(category=3),
        languages={"english": {"supported": "true"}, "german": {"supported": "true"}},
        current_build_id="111",
        last_update_timestamp=datetime(2026, 3, 1, 12, 0, 0),
    )

    for key, value in overrides.items():
        setattr(app, key, value)

    return app


@pytest.fixture
def history_database(monkeypatch: pytest.MonkeyPatch) -> tuple[PICSDatabase, FakeSupabaseClient]:
    fake_client = FakeSupabaseClient()
    database = create_history_database(monkeypatch, fake_client)
    return database, fake_client


def test_capture_change_history_inserts_snapshot_and_events_for_changed_app(
    history_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = history_database
    previous_snapshot = {
        "id": 10,
        "appid": 730,
        "source": "pics",
        "content_hash": "prior-hash",
        "first_seen_at": "2026-03-01T12:00:00",
        "snapshot_data": {
            "appid": 730,
            "store_tags": [1, 2],
            "genres": [1, 3],
            "categories": [2, 28],
            "languages": {"english": {"supported": "true"}, "german": {"supported": "true"}},
            "platforms": ["windows"],
            "controller_support": "full",
            "steam_deck_category": "verified",
            "publisher_names": ["Valve"],
            "developer_names": ["Valve"],
            "dlc_appids": [100, 200],
            "current_build_id": "111",
            "last_content_update": "2026-03-01T12:00:00",
        },
    }
    fake_client.snapshots.append(deepcopy(previous_snapshot))

    database._capture_change_history(
        [build_app(store_tags=[2, 3], platforms=["windows", "linux"], current_build_id="222")],
        trigger_reason="change_monitor",
        trigger_cursor="456",
    )

    assert len(fake_client.snapshots) == 2
    new_snapshot = max(fake_client.snapshots, key=lambda row: int(row["id"]))
    assert new_snapshot["previous_snapshot_id"] == 10
    assert new_snapshot["trigger_reason"] == "change_monitor"
    assert new_snapshot["trigger_cursor"] == "456"

    event_types = {event["change_type"] for event in fake_client.inserted_events}
    assert {"tags_added", "tags_removed", "platforms_changed", "build_id_changed"} <= event_types
    assert all(event["source"] == "pics" for event in fake_client.inserted_events)
    assert all(event["trigger_cursor"] == "456" for event in fake_client.inserted_events)


def test_capture_change_history_updates_last_seen_without_new_snapshot_when_hash_matches(
    history_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = history_database
    app = build_app()
    normalized_snapshot = normalize_pics_snapshot(app)
    fake_client.snapshots.append(
        {
            "id": 7,
            "appid": 730,
            "source": "pics",
            "content_hash": hash_normalized_snapshot(normalized_snapshot),
            "first_seen_at": "2026-03-01T12:00:00",
            "last_seen_at": "2026-03-01T12:00:00",
            "snapshot_data": normalized_snapshot,
        }
    )

    database._capture_change_history([app], trigger_reason="bulk_sync", trigger_cursor=None)

    assert len(fake_client.snapshots) == 1
    assert fake_client.inserted_events == []
    assert len(fake_client.snapshot_updates) == 1
    assert fake_client.snapshot_updates[0]["id"] == 7
    assert fake_client.snapshot_updates[0]["last_seen_at"] != "2026-03-01T12:00:00"


def test_capture_change_history_can_write_to_tiger_history_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    previous_snapshot = {
        "id": 10,
        "appid": 730,
        "source": "pics",
        "content_hash": "prior-hash",
        "first_seen_at": "2026-03-01T12:00:00",
        "snapshot_data": normalize_pics_snapshot(build_app(store_tags=[1], platforms=["windows"])),
    }
    fake_store = FakeTigerHistoryStore(latest_snapshots={730: previous_snapshot})
    fake_client = FakeSupabaseClient()

    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "tiger")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(PICSDatabase, "_create_tiger_change_history_store", lambda self: fake_store)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )
    database = PICSDatabase()

    database._capture_change_history(
        [build_app(store_tags=[2, 3], platforms=["windows", "linux"], current_build_id="222")],
        trigger_reason="change_monitor",
        trigger_cursor="456",
    )

    assert fake_store.inserted_snapshots
    assert fake_store.inserted_snapshots[0]["previous_snapshot_id"] == 10
    assert fake_store.inserted_events
    assert all(event["source"] == "pics" for event in fake_store.inserted_events)
    assert fake_client.calls == []


def test_capture_change_history_updates_tiger_last_seen_for_unchanged_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = build_app()
    normalized_snapshot = normalize_pics_snapshot(app)
    fake_store = FakeTigerHistoryStore(
        latest_snapshots={
            730: {
                "id": 7,
                "appid": 730,
                "content_hash": hash_normalized_snapshot(normalized_snapshot),
                "first_seen_at": "2026-03-01T12:00:00",
                "snapshot_data": normalized_snapshot,
            }
        }
    )
    fake_client = FakeSupabaseClient()

    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "tiger")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(PICSDatabase, "_create_tiger_change_history_store", lambda self: fake_store)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )
    database = PICSDatabase()

    database._capture_change_history([app], trigger_reason="bulk_sync", trigger_cursor=None)

    assert fake_store.updated_snapshot_ids == [7]
    assert fake_store.updated_observed_at is not None
    assert fake_store.inserted_snapshots == []
    assert fake_store.inserted_events == []
    assert fake_client.calls == []


def test_upsert_apps_batch_captures_history_before_latest_state_write(
    history_database: tuple[PICSDatabase, FakeSupabaseClient],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database, fake_client = history_database
    fake_client.existing_appids.add(730)

    stub_latest_state_writes(monkeypatch, database)

    stats = database.upsert_apps_batch([build_app()], trigger_reason="bulk_sync", trigger_cursor="42")

    assert stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert ("app_source_snapshots", "insert") in fake_client.calls
    assert ("apps", "upsert") in fake_client.calls
    assert fake_client.calls.index(("app_source_snapshots", "insert")) < fake_client.calls.index(("apps", "upsert"))


def test_batch_update_sync_status_persists_pics_change_number(
    history_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = history_database

    database._batch_update_sync_status([730, 570], trigger_cursor="912345")

    assert len(fake_client.sync_status_upserts) == 2
    assert {record["appid"] for record in fake_client.sync_status_upserts} == {570, 730}
    assert all(record["pics_change_number"] == 912345 for record in fake_client.sync_status_upserts)


def test_capture_change_history_retries_transient_schema_cache_select_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient(
        failures={
            ("app_source_snapshots", "select"): [schema_cache_error()],
        }
    )
    database = create_history_database(monkeypatch, fake_client)
    clock = FakeClock()

    database.HISTORY_RETRY_DELAY_SECONDS = 0.0
    monkeypatch.setattr("src.database.operations.time.monotonic", clock.monotonic)
    monkeypatch.setattr("src.database.operations.time.sleep", clock.sleep)

    previous_snapshot = {
        "id": 10,
        "appid": 730,
        "source": "pics",
        "content_hash": "prior-hash",
        "first_seen_at": "2026-03-01T12:00:00",
        "snapshot_data": normalize_pics_snapshot(build_app(store_tags=[1], platforms=["windows"])),
    }
    fake_client.snapshots.append(deepcopy(previous_snapshot))

    database._capture_change_history(
        [build_app(store_tags=[2, 3], platforms=["windows", "linux"], current_build_id="222")],
        trigger_reason="change_monitor",
        trigger_cursor="456",
    )

    assert fake_client.calls.count(("app_source_snapshots", "select")) == 2
    assert len(fake_client.snapshots) == 2
    assert fake_client.inserted_events
    assert database._history_available is True
    assert database._history_disabled_until is None


def test_capture_change_history_retries_schema_cache_insert_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient(
        failures={
            ("app_source_snapshots", "insert"): [schema_cache_error()],
        }
    )
    database = create_history_database(monkeypatch, fake_client)
    clock = FakeClock()

    database.HISTORY_RETRY_DELAY_SECONDS = 0.0
    monkeypatch.setattr("src.database.operations.time.monotonic", clock.monotonic)
    monkeypatch.setattr("src.database.operations.time.sleep", clock.sleep)

    database._capture_change_history([build_app()], trigger_reason="bulk_sync", trigger_cursor=None)

    assert fake_client.calls.count(("app_source_snapshots", "insert")) == 2
    assert len(fake_client.snapshots) == 1
    assert database._history_available is True
    assert database._history_disabled_until is None


def test_upsert_apps_batch_enters_history_cooldown_without_blocking_latest_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient(
        existing_appids=[730],
        failures={
            ("app_source_snapshots", "select"): [
                schema_cache_error(),
                schema_cache_error(),
                schema_cache_error(),
            ],
        },
    )
    database = create_history_database(monkeypatch, fake_client)
    clock = FakeClock()

    database.HISTORY_RETRY_DELAY_SECONDS = 0.0
    database.HISTORY_FAILURE_COOLDOWN_SECONDS = 10.0
    monkeypatch.setattr("src.database.operations.time.monotonic", clock.monotonic)
    monkeypatch.setattr("src.database.operations.time.sleep", clock.sleep)
    stub_latest_state_writes(monkeypatch, database)

    first_stats = database.upsert_apps_batch([build_app()], trigger_reason="bulk_sync", trigger_cursor="42")
    first_select_calls = fake_client.calls.count(("app_source_snapshots", "select"))

    assert first_stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert ("apps", "upsert") in fake_client.calls
    assert first_select_calls == 3
    assert database._history_available is False
    assert database._history_disabled_until == pytest.approx(10.0)

    second_stats = database.upsert_apps_batch([build_app()], trigger_reason="bulk_sync", trigger_cursor="43")

    assert second_stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert fake_client.calls.count(("app_source_snapshots", "select")) == first_select_calls


def test_history_capture_recovers_after_cooldown_expires(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient(
        existing_appids=[730],
        failures={
            ("app_source_snapshots", "select"): [
                schema_cache_error(),
                schema_cache_error(),
                schema_cache_error(),
            ],
        },
    )
    database = create_history_database(monkeypatch, fake_client)
    clock = FakeClock()

    database.HISTORY_RETRY_DELAY_SECONDS = 0.0
    database.HISTORY_FAILURE_COOLDOWN_SECONDS = 10.0
    monkeypatch.setattr("src.database.operations.time.monotonic", clock.monotonic)
    monkeypatch.setattr("src.database.operations.time.sleep", clock.sleep)
    stub_latest_state_writes(monkeypatch, database)

    first_stats = database.upsert_apps_batch([build_app()], trigger_reason="bulk_sync", trigger_cursor="42")

    assert first_stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert database._history_available is False
    assert len(fake_client.snapshots) == 0

    clock.now = 11.0
    second_stats = database.upsert_apps_batch([build_app()], trigger_reason="bulk_sync", trigger_cursor="43")

    assert second_stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert len(fake_client.snapshots) == 1
    assert database._history_available is True
    assert database._history_disabled_until is None
