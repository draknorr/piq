from __future__ import annotations

import os
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional

import pytest

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

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


def create_database(monkeypatch: pytest.MonkeyPatch, fake_client: FakeSupabaseClient) -> PICSDatabase:
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
