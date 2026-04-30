from __future__ import annotations

import os
from pathlib import Path
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import src.database.operations as operations_module
from src.database.operations import PICSDatabase
from src.extractors.common import ExtractedPICSData


class FakeResult:
    def __init__(self, data: Optional[Any] = None):
        self.data = [] if data is None else data


class FakeTableQuery:
    def __init__(self, client: "FakeSupabaseClient", table_name: str):
        self.client = client
        self.table_name = table_name
        self.payload: Any = None
        self.on_conflict: Optional[str] = None

    def upsert(self, payload: Any, on_conflict: Optional[str] = None) -> "FakeTableQuery":
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def execute(self) -> FakeResult:
        return self.client.execute(self.table_name, self.payload)


class FakeSupabaseClient:
    def __init__(self, fail_multi_row_batches: bool = False, always_fail_appids: Optional[List[int]] = None):
        self.fail_multi_row_batches = fail_multi_row_batches
        self.always_fail_appids = set(always_fail_appids or [])
        self.upsert_calls: List[List[Dict[str, Any]]] = []

    def table(self, table_name: str) -> FakeTableQuery:
        if table_name != "apps":
            raise AssertionError(f"Unexpected table: {table_name}")
        return FakeTableQuery(self, table_name)

    def execute(self, table_name: str, payload: Any) -> FakeResult:
        rows = payload if isinstance(payload, list) else [payload]
        self.upsert_calls.append(rows)

        if self.fail_multi_row_batches and len(rows) > 1:
            raise Exception("simulated batch failure")

        failing_row = next((row for row in rows if int(row["appid"]) in self.always_fail_appids), None)
        if failing_row is not None:
            raise Exception(f"simulated row failure for {failing_row['appid']}")

        return FakeResult(rows)


class FakeSupabaseWrapper:
    def __init__(self, client: FakeSupabaseClient):
        self.client = client


class FakeTigerLatestStateStore:
    def __init__(self):
        self.app_records: List[Dict[str, Any]] = []
        self.sync_status_updates: List[tuple[List[int], Optional[str]]] = []

    def get_existing_appids(self, appids: List[int]) -> List[int]:
        return list(appids)

    def get_existing_app_names(self, appids: List[int]) -> Dict[int, str]:
        return {}

    def get_apps_with_storefront_dates(self, appids: List[int]) -> set[int]:
        return set()

    def get_apps_with_storefront_sync(self, appids: List[int]) -> set[int]:
        return set()

    def upsert_app_records(self, records: List[Dict[str, Any]]) -> set[int]:
        self.app_records.extend(records)
        return {int(record["appid"]) for record in records}

    def replace_categories(self, appid: int, category_records: List[Dict[str, Any]], category_ids: List[int]) -> None:
        pass

    def replace_genres(
        self,
        appid: int,
        genre_records: List[Dict[str, Any]],
        genre_ids: List[int],
        primary_genre_id: Optional[int],
    ) -> None:
        pass

    def replace_store_tags(self, appid: int, tag_records: List[Dict[str, Any]], tag_ids: List[int]) -> None:
        pass

    def update_sync_status(self, appids: List[int], trigger_cursor: Optional[str]) -> None:
        self.sync_status_updates.append((list(appids), trigger_cursor))


def create_database(monkeypatch: pytest.MonkeyPatch, fake_client: FakeSupabaseClient) -> PICSDatabase:
    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "supabase")
    monkeypatch.setattr(operations_module.settings, "pics_latest_state_target", "supabase")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )
    return PICSDatabase()


def build_app(appid: int, name: Optional[str]) -> ExtractedPICSData:
    return ExtractedPICSData(appid=appid, name=name, type="game")


def test_upsert_apps_batch_preserves_existing_name_when_pics_name_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = FakeSupabaseClient()
    db = create_database(monkeypatch, fake_client)

    monkeypatch.setattr(PICSDatabase, "_get_existing_appids", lambda self, appids: appids)
    monkeypatch.setattr(PICSDatabase, "_get_existing_app_names", lambda self, appids: {123: "Stored Name"})
    monkeypatch.setattr(PICSDatabase, "_capture_change_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_dates", lambda self, appids: set())
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_sync", lambda self, appids: set())
    synced_appids: List[int] = []
    monkeypatch.setattr(
        PICSDatabase,
        "_sync_relationships",
        lambda self, apps, successful_appids, trigger_cursor=None: synced_appids.extend(sorted(successful_appids)),
    )

    stats = db.upsert_apps_batch([build_app(123, None)], trigger_reason="first_pass")

    assert stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert fake_client.upsert_calls[0][0]["name"] == "Stored Name"
    assert synced_appids == [123]


def test_upsert_apps_batch_retries_individual_rows_after_batch_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient(fail_multi_row_batches=True, always_fail_appids=[222])
    db = create_database(monkeypatch, fake_client)

    monkeypatch.setattr(PICSDatabase, "_get_existing_appids", lambda self, appids: appids)
    monkeypatch.setattr(PICSDatabase, "_get_existing_app_names", lambda self, appids: {})
    monkeypatch.setattr(PICSDatabase, "_capture_change_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_dates", lambda self, appids: set())
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_sync", lambda self, appids: set())
    synced_appids: List[int] = []
    monkeypatch.setattr(
        PICSDatabase,
        "_sync_relationships",
        lambda self, apps, successful_appids, trigger_cursor=None: synced_appids.extend(sorted(successful_appids)),
    )

    stats = db.upsert_apps_batch(
        [build_app(111, "Good App"), build_app(222, "Bad App")],
        trigger_reason="first_pass",
    )

    assert stats == {"created": 0, "updated": 1, "failed": 1, "skipped": 0}
    assert len(fake_client.upsert_calls) == 3
    assert fake_client.upsert_calls[1][0]["appid"] == 111
    assert fake_client.upsert_calls[2][0]["appid"] == 222
    assert synced_appids == [111]


def test_upsert_apps_batch_splits_storefront_synced_rows_from_fallback_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient()
    db = create_database(monkeypatch, fake_client)

    monkeypatch.setattr(PICSDatabase, "_get_existing_appids", lambda self, appids: appids)
    monkeypatch.setattr(PICSDatabase, "_get_existing_app_names", lambda self, appids: {})
    monkeypatch.setattr(PICSDatabase, "_capture_change_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_dates", lambda self, appids: set())
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_sync", lambda self, appids: {111})
    monkeypatch.setattr(PICSDatabase, "_sync_relationships", lambda *args, **kwargs: None)

    stats = db.upsert_apps_batch(
        [build_app(111, "Storefront Authority"), build_app(222, "Fallback Authority")],
        trigger_reason="first_pass",
    )

    assert stats == {"created": 0, "updated": 2, "failed": 0, "skipped": 0}
    assert len(fake_client.upsert_calls) == 2

    storefront_keys = set(fake_client.upsert_calls[0][0].keys())
    fallback_keys = set(fake_client.upsert_calls[1][0].keys())

    assert fake_client.upsert_calls[0][0]["appid"] == 111
    assert "is_free" not in storefront_keys
    assert "is_released" not in storefront_keys
    assert fake_client.upsert_calls[1][0]["appid"] == 222
    assert "is_free" in fallback_keys
    assert "is_released" in fallback_keys


def test_upsert_apps_batch_splits_release_date_omission_into_a_separate_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient()
    db = create_database(monkeypatch, fake_client)

    storefront_dated_app = build_app(111, "Storefront Date")
    fallback_dated_app = build_app(222, "Fallback Date")
    fallback_dated_app.steam_release_date = datetime(2026, 3, 31)

    monkeypatch.setattr(PICSDatabase, "_get_existing_appids", lambda self, appids: appids)
    monkeypatch.setattr(PICSDatabase, "_get_existing_app_names", lambda self, appids: {})
    monkeypatch.setattr(PICSDatabase, "_capture_change_history", lambda *args, **kwargs: None)
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_dates", lambda self, appids: {111})
    monkeypatch.setattr(PICSDatabase, "_get_apps_with_storefront_sync", lambda self, appids: set())
    monkeypatch.setattr(PICSDatabase, "_sync_relationships", lambda *args, **kwargs: None)

    stats = db.upsert_apps_batch(
        [storefront_dated_app, fallback_dated_app],
        trigger_reason="first_pass",
    )

    assert stats == {"created": 0, "updated": 2, "failed": 0, "skipped": 0}
    assert len(fake_client.upsert_calls) == 2

    storefront_date_keys = set(fake_client.upsert_calls[0][0].keys())
    fallback_date_keys = set(fake_client.upsert_calls[1][0].keys())

    assert fake_client.upsert_calls[0][0]["appid"] == 111
    assert "release_date" not in storefront_date_keys
    assert fake_client.upsert_calls[1][0]["appid"] == 222
    assert "release_date" in fallback_date_keys


def test_upsert_apps_batch_uses_tiger_latest_state_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = FakeSupabaseClient()
    fake_store = FakeTigerLatestStateStore()

    monkeypatch.setattr(operations_module.settings, "pics_latest_state_target", "tiger")
    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "supabase")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )
    monkeypatch.setattr(
        PICSDatabase,
        "_create_tiger_latest_state_store",
        lambda self: fake_store,
    )

    database = PICSDatabase()
    monkeypatch.setattr(database, "_capture_change_history", lambda *args, **kwargs: None)

    stats = database.upsert_apps_batch([build_app(123, "Tiger App")], trigger_reason="first_pass")

    assert stats == {"created": 0, "updated": 1, "failed": 0, "skipped": 0}
    assert fake_client.upsert_calls == []
    assert [record["appid"] for record in fake_store.app_records] == [123]
    assert fake_store.sync_status_updates == [([123], None)]
