from __future__ import annotations

import os
from copy import deepcopy
from pathlib import Path
import sys
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
        self.action: Optional[str] = None
        self.payload: Any = None
        self.filters: List[tuple[str, str, Any]] = []
        self.on_conflict: Optional[str] = None

    def upsert(self, payload: Any, on_conflict: Optional[str] = None) -> "FakeTableQuery":
        self.action = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def delete(self) -> "FakeTableQuery":
        self.action = "delete"
        return self

    def eq(self, key: str, value: Any) -> "FakeTableQuery":
        self.filters.append(("eq", key, value))
        return self

    def execute(self) -> FakeResult:
        return self.client.execute(self)


class FakeRPCQuery:
    def __init__(self, client: "FakeSupabaseClient", function_name: str, params: Dict[str, Any]):
        self.client = client
        self.function_name = function_name
        self.params = params

    def execute(self) -> FakeResult:
        return self.client.execute_rpc(self.function_name, self.params)


class FakeSupabaseClient:
    def __init__(self):
        self.calls: List[tuple[str, str]] = []
        self.rpc_calls: List[tuple[str, Dict[str, Any]]] = []
        self.fail_rpcs: set[str] = set()
        self.tables: Dict[str, List[Dict[str, Any]]] = {
            "app_categories": [],
            "app_dlc": [],
            "app_genres": [],
            "app_steam_tags": [],
            "steam_categories": [],
            "steam_genres": [],
            "steam_tags": [],
        }
        self._created_at_counter = 0

    def table(self, table_name: str) -> FakeTableQuery:
        return FakeTableQuery(self, table_name)

    def rpc(self, function_name: str, params: Dict[str, Any]) -> FakeRPCQuery:
        self.rpc_calls.append((function_name, deepcopy(params)))
        return FakeRPCQuery(self, function_name, params)

    def execute(self, query: FakeTableQuery) -> FakeResult:
        self.calls.append((query.table_name, query.action or "unknown"))

        if query.action == "upsert":
            rows = self._normalize_rows(query.payload)
            self._upsert_lookup_rows(query.table_name, rows)
            return FakeResult(rows)

        if query.action == "delete":
            appid = self._filter_value(query.filters, "eq", "appid")
            if appid is not None:
                self.tables[query.table_name] = [
                    row for row in self.tables.get(query.table_name, []) if row.get("appid") != appid
                ]
            return FakeResult([])

        return FakeResult([])

    def execute_rpc(self, function_name: str, params: Dict[str, Any]) -> FakeResult:
        snapshot = deepcopy(self.tables)

        try:
            if function_name in self.fail_rpcs:
                raise RuntimeError(f"Simulated failure for {function_name}")

            if function_name == "replace_app_categories":
                self._replace_app_categories(params["p_appid"], params.get("p_category_ids"))
            elif function_name == "replace_app_genres":
                self._replace_app_genres(
                    params["p_appid"],
                    params.get("p_genre_ids"),
                    params.get("p_primary_genre_id"),
                )
            elif function_name == "replace_app_steam_tags":
                self._replace_app_steam_tags(params["p_appid"], params.get("p_tag_ids"))
            elif function_name == "seed_discovered_apps":
                pass
            else:
                raise AssertionError(f"Unexpected RPC call: {function_name}")
        except Exception:
            self.tables = snapshot
            raise

        return FakeResult([])

    def _replace_app_categories(self, appid: int, category_ids: Optional[List[int]]) -> None:
        desired_ids = sorted({category_id for category_id in (category_ids or []) if category_id is not None})
        existing = {row["category_id"]: row for row in self._rows_for_app("app_categories", appid)}

        for category_id in desired_ids:
            if category_id not in existing:
                self.tables["app_categories"].append(
                    {
                        "appid": appid,
                        "category_id": category_id,
                        "created_at": self._next_created_at(),
                    }
                )

        self.tables["app_categories"] = [
            row
            for row in self.tables["app_categories"]
            if row["appid"] != appid or row["category_id"] in desired_ids
        ]

    def _replace_app_genres(
        self,
        appid: int,
        genre_ids: Optional[List[int]],
        primary_genre_id: Optional[int],
    ) -> None:
        desired_ids = list(dict.fromkeys(genre_id for genre_id in (genre_ids or []) if genre_id is not None))
        existing = {row["genre_id"]: row for row in self._rows_for_app("app_genres", appid)}

        for genre_id in desired_ids:
            is_primary = genre_id == primary_genre_id
            if genre_id in existing:
                existing[genre_id]["is_primary"] = is_primary
            else:
                self.tables["app_genres"].append(
                    {
                        "appid": appid,
                        "genre_id": genre_id,
                        "is_primary": is_primary,
                        "created_at": self._next_created_at(),
                    }
                )

        desired_set = set(desired_ids)
        self.tables["app_genres"] = [
            row
            for row in self.tables["app_genres"]
            if row["appid"] != appid or row["genre_id"] in desired_set
        ]

    def _replace_app_steam_tags(self, appid: int, tag_ids: Optional[List[int]]) -> None:
        ordered_tag_ids = list(dict.fromkeys(tag_id for tag_id in (tag_ids or []) if tag_id is not None))
        existing = {row["tag_id"]: row for row in self._rows_for_app("app_steam_tags", appid)}

        for rank, tag_id in enumerate(ordered_tag_ids):
            if tag_id in existing:
                existing[tag_id]["rank"] = rank
            else:
                self.tables["app_steam_tags"].append(
                    {
                        "appid": appid,
                        "tag_id": tag_id,
                        "rank": rank,
                        "created_at": self._next_created_at(),
                    }
                )

        desired_set = set(ordered_tag_ids)
        self.tables["app_steam_tags"] = [
            row
            for row in self.tables["app_steam_tags"]
            if row["appid"] != appid or row["tag_id"] in desired_set
        ]

    def _upsert_lookup_rows(self, table_name: str, rows: List[Dict[str, Any]]) -> None:
        if table_name not in self.tables:
            self.tables[table_name] = []

        key_name = {
            "steam_categories": "category_id",
            "steam_genres": "genre_id",
            "steam_tags": "tag_id",
        }.get(table_name)

        if key_name is None:
            return

        existing = {row[key_name]: row for row in self.tables[table_name]}
        for row in rows:
            key = row[key_name]
            if key in existing:
                existing[key].update(deepcopy(row))
            else:
                self.tables[table_name].append(deepcopy(row))

    def _rows_for_app(self, table_name: str, appid: int) -> List[Dict[str, Any]]:
        return [row for row in self.tables[table_name] if row["appid"] == appid]

    def _next_created_at(self) -> str:
        self._created_at_counter += 1
        return f"2026-03-01T12:00:{self._created_at_counter:02d}Z"

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


def build_app(**overrides: Any) -> ExtractedPICSData:
    app = ExtractedPICSData(
        appid=730,
        name="Counter-Strike 2",
        categories={2: True},
        genres=[1],
        primary_genre=1,
        store_tags=[10],
    )

    for key, value in overrides.items():
        setattr(app, key, value)

    return app


def rows_for_app(fake_client: FakeSupabaseClient, table_name: str, appid: int = 730) -> List[Dict[str, Any]]:
    return sorted(
        (deepcopy(row) for row in fake_client.tables[table_name] if row["appid"] == appid),
        key=lambda row: tuple(row[key] for key in sorted(row)),
    )


@pytest.fixture
def relation_database(monkeypatch: pytest.MonkeyPatch) -> tuple[PICSDatabase, FakeSupabaseClient]:
    fake_client = FakeSupabaseClient()

    monkeypatch.setattr(operations_module.settings, "pics_change_history_target", "supabase")
    monkeypatch.setattr(operations_module.settings, "pics_latest_state_target", "supabase")
    monkeypatch.setattr(PICSDatabase, "_load_tag_names", lambda self: None)
    monkeypatch.setattr(
        "src.database.operations.SupabaseClient.get_instance",
        lambda: FakeSupabaseWrapper(fake_client),
    )

    database = PICSDatabase()
    monkeypatch.setattr(database, "_batch_update_sync_status", lambda appids, trigger_cursor=None: None)
    return database, fake_client


def test_empty_relationship_payloads_clear_existing_rows(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database
    fake_client.tables["app_categories"] = [{"appid": 730, "category_id": 2, "created_at": "2026-01-01T00:00:00Z"}]
    fake_client.tables["app_genres"] = [{"appid": 730, "genre_id": 1, "is_primary": True, "created_at": "2026-01-01T00:00:01Z"}]
    fake_client.tables["app_steam_tags"] = [{"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:02Z"}]

    database._sync_relationships([build_app(categories={}, genres=[], primary_genre=None, store_tags=[])], {730})

    assert rows_for_app(fake_client, "app_categories") == []
    assert rows_for_app(fake_client, "app_genres") == []
    assert rows_for_app(fake_client, "app_steam_tags") == []
    assert [name for name, _ in fake_client.rpc_calls] == [
        "replace_app_categories",
        "replace_app_genres",
        "replace_app_steam_tags",
    ]


def test_unchanged_relationships_preserve_created_at(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database
    fake_client.tables["app_categories"] = [{"appid": 730, "category_id": 2, "created_at": "2026-01-01T00:00:00Z"}]
    fake_client.tables["app_genres"] = [{"appid": 730, "genre_id": 1, "is_primary": True, "created_at": "2026-01-01T00:00:01Z"}]
    fake_client.tables["app_steam_tags"] = [{"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:02Z"}]

    database._sync_relationships([build_app()], {730})

    assert rows_for_app(fake_client, "app_categories") == [
        {"appid": 730, "category_id": 2, "created_at": "2026-01-01T00:00:00Z"}
    ]
    assert rows_for_app(fake_client, "app_genres") == [
        {"appid": 730, "genre_id": 1, "is_primary": True, "created_at": "2026-01-01T00:00:01Z"}
    ]
    assert rows_for_app(fake_client, "app_steam_tags") == [
        {"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:02Z"}
    ]


def test_tag_reordering_updates_rank_without_recreating_rows(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database
    fake_client.tables["app_steam_tags"] = [
        {"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "tag_id": 20, "rank": 1, "created_at": "2026-01-01T00:00:01Z"},
    ]

    database._sync_store_tags(730, [20, 10])

    assert rows_for_app(fake_client, "app_steam_tags") == [
        {"appid": 730, "tag_id": 10, "rank": 1, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "tag_id": 20, "rank": 0, "created_at": "2026-01-01T00:00:01Z"},
    ]


def test_primary_genre_change_updates_is_primary_without_recreating_rows(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database
    fake_client.tables["app_genres"] = [
        {"appid": 730, "genre_id": 1, "is_primary": True, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "genre_id": 3, "is_primary": False, "created_at": "2026-01-01T00:00:01Z"},
    ]

    database._sync_genres(730, [1, 3], 3)

    assert rows_for_app(fake_client, "app_genres") == [
        {"appid": 730, "genre_id": 1, "is_primary": False, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "genre_id": 3, "is_primary": True, "created_at": "2026-01-01T00:00:01Z"},
    ]


def test_rpc_failure_does_not_empty_existing_tag_rows(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database
    fake_client.tables["app_steam_tags"] = [
        {"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "tag_id": 20, "rank": 1, "created_at": "2026-01-01T00:00:01Z"},
    ]
    fake_client.fail_rpcs.add("replace_app_steam_tags")

    database._sync_store_tags(730, [20, 30])

    assert rows_for_app(fake_client, "app_steam_tags") == [
        {"appid": 730, "tag_id": 10, "rank": 0, "created_at": "2026-01-01T00:00:00Z"},
        {"appid": 730, "tag_id": 20, "rank": 1, "created_at": "2026-01-01T00:00:01Z"},
    ]
    assert ("app_steam_tags", "delete") not in fake_client.calls


def test_sync_dlc_relationships_seeds_missing_dlc_ids_before_upsert(
    relation_database: tuple[PICSDatabase, FakeSupabaseClient],
) -> None:
    database, fake_client = relation_database

    database._sync_dlc_relationships(1245620, [2778580, 2778590, 2778580])

    assert fake_client.rpc_calls[0] == (
        "seed_discovered_apps",
        {
            "p_records": [
                {
                    "appid": 2778580,
                    "app_type": "dlc",
                    "discovery_reason": "pics_dlc_reference",
                },
                {
                    "appid": 2778590,
                    "app_type": "dlc",
                    "discovery_reason": "pics_dlc_reference",
                },
            ]
        },
    )
    assert ("app_dlc", "upsert") in fake_client.calls
