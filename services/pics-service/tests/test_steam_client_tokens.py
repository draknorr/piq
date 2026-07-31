import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

client_module = importlib.import_module("src.steam.client")
if getattr(client_module, "PICSSteamClient", None) is object:
    # Older isolated worker tests install a minimal import stub at collection
    # time. Reload the real module for these client-level lifecycle tests.
    sys.modules.pop("src.steam.client", None)
    client_module = importlib.import_module("src.steam.client")
PICSSteamClient = client_module.PICSSteamClient


class ImmediateScheduler:
    def __init__(self):
        self.calls = []

    def execute(self, name, operation):
        self.calls.append(name)
        return operation()


class RawSteamClient:
    def __init__(self):
        self.responses = [
            {"apps": {7: 111}, "packages": {}},
            {"apps": {7: 222}, "packages": {}},
        ]
        self.calls = []

    def get_access_tokens(self, *, app_ids, package_ids):
        self.calls.append((list(app_ids), list(package_ids)))
        return self.responses.pop(0)


def make_client():
    client = PICSSteamClient.__new__(PICSSteamClient)
    client._client = RawSteamClient()
    client._request_scheduler = ImmediateScheduler()
    client._access_token_ttl_seconds = 60
    client._access_tokens = {}
    client._expired_access_token_reasons = {}
    return client


def test_access_tokens_are_cached_then_refreshed_after_ttl(monkeypatch):
    client = make_client()
    now = 100.0
    monkeypatch.setattr(client_module.time, "monotonic", lambda: now)

    first_tokens, first_evidence = client.acquire_access_tokens([7])
    cached_tokens, cached_evidence = client.acquire_access_tokens([7])
    now = 161.0
    refreshed_tokens, refreshed_evidence = client.acquire_access_tokens([7])

    assert first_tokens == {7: 111}
    assert first_evidence[7]["status"] == "acquired"
    assert cached_tokens == {7: 111}
    assert cached_evidence[7]["status"] == "cached"
    assert refreshed_tokens == {7: 222}
    assert refreshed_evidence[7]["status"] == "refreshed"
    assert refreshed_evidence[7]["refreshReason"] == "ttl_expired"
    assert client._client.calls == [([7], []), ([7], [])]
    assert client._request_scheduler.calls == [
        "pics_access_tokens",
        "pics_access_tokens",
    ]


def test_force_refresh_invalidates_a_still_live_token(monkeypatch):
    client = make_client()
    monkeypatch.setattr(client_module.time, "monotonic", lambda: 100.0)

    client.acquire_access_tokens([7])
    tokens, evidence = client.acquire_access_tokens([7], force_refresh=True)

    assert tokens == {7: 222}
    assert evidence[7]["status"] == "refreshed"
    assert evidence[7]["refreshReason"] == "forced"
    assert client._client.calls == [([7], []), ([7], [])]


def test_rejected_token_records_refresh_reason(monkeypatch):
    client = make_client()
    monkeypatch.setattr(client_module.time, "monotonic", lambda: 100.0)

    client.acquire_access_tokens([7])
    client.expire_access_token(7)
    tokens, evidence = client.acquire_access_tokens([7], force_refresh=True)

    assert tokens == {7: 222}
    assert evidence[7]["status"] == "refreshed"
    assert evidence[7]["refreshReason"] == "steam_rejected"
