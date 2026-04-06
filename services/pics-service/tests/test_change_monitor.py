import os
from pathlib import Path
import sys
from types import ModuleType

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")

fake_client_module = ModuleType("src.steam.client")
fake_client_module.PICSSteamClient = object
sys.modules.setdefault("src.steam.client", fake_client_module)

fake_bulk_sync_module = ModuleType("src.workers.bulk_sync")
fake_bulk_sync_module.BulkSyncWorker = object
sys.modules.setdefault("src.workers.bulk_sync", fake_bulk_sync_module)

import src.workers.change_monitor as change_monitor_module
from src.workers.change_monitor import ChangeMonitorWorker


class FakeSteamClient:
    def __init__(self):
        self.is_connected = True
        self.connection_age_seconds = None
        self.is_reconnecting = False
        self.reconnect_attempts = 0
        self.last_reconnect_error = None
        self.last_disconnect_at = None
        self.last_successful_connection_at = None
        self.disconnect_called = False

    def set_heartbeat_interval(self, _seconds):
        return None

    def set_auto_reconnect(self, _enabled):
        return None

    def connect(self):
        return True

    def disconnect(self):
        self.disconnect_called = True
        self.is_connected = False


class FailingFetcher:
    def __init__(self):
        self.calls = 0

    def get_changes_since(self, _change_number):
        self.calls += 1
        raise RuntimeError("poll failed")


class FakeDatabase:
    def __init__(self):
        self.last_change_number = 10

    def get_last_change_number(self):
        return self.last_change_number

    def set_last_change_number(self, value):
        self.last_change_number = value


class FakeHealthServer:
    def __init__(self):
        self.updates = []

    def update_status(self, data):
        self.updates.append(dict(data))


def test_change_monitor_exits_after_repeated_poll_failures(monkeypatch):
    fake_fetcher = FailingFetcher()
    fake_health = FakeHealthServer()
    worker = ChangeMonitorWorker(health_server=fake_health)
    worker._steam = FakeSteamClient()
    worker._db = FakeDatabase()

    monkeypatch.setattr(change_monitor_module, "PICSFetcher", lambda *_args, **_kwargs: fake_fetcher)
    monkeypatch.setattr(change_monitor_module.time, "sleep", lambda *_args, **_kwargs: None)

    with pytest.raises(RuntimeError, match="Exceeded consecutive change poll failures"):
        worker.run()

    assert fake_fetcher.calls == worker.MAX_CONSECUTIVE_POLL_FAILURES
    assert fake_health.updates[-1]["health_state"] == "unhealthy"
    assert worker._steam.disconnect_called is True
