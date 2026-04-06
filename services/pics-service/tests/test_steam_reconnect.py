from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import gevent
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

fake_client_module = ModuleType("src.steam.client")
fake_client_module.PICSSteamClient = object
sys.modules.setdefault("src.steam.client", fake_client_module)

from src.steam import pics as pics_module
from src.steam.pics import PICSFetcher


class FakeSteamApiClient:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = 0

    def get_changes_since(self, *_args, **_kwargs):
        self.calls += 1
        if self.responses:
            response = self.responses.pop(0)
            if callable(response):
                response = response()
            if isinstance(response, BaseException):
                raise response
            return response

        return None


class FakeClient:
    def __init__(self, *, connected=False, wait_result=False, reconnect_result=False, responses=None):
        self.is_connected = connected
        self.wait_result = wait_result
        self.reconnect_result = reconnect_result
        self.wait_calls = 0
        self.reconnect_calls = []
        self.client = FakeSteamApiClient(responses=responses)

    def wait_for_connection(self, timeout=120):
        self.wait_calls += 1
        if self.wait_result:
            self.is_connected = True
        return self.wait_result

    def reconnect(self, max_attempts=0, force=False):
        self.reconnect_calls.append((max_attempts, force))
        if self.reconnect_result:
            self.is_connected = True
        return self.reconnect_result

    def ensure_connected(self, wait_timeout=120, reconnect_attempts=3):
        if self.is_connected:
            return True
        if self.wait_for_connection(timeout=wait_timeout):
            return True
        return self.reconnect(max_attempts=reconnect_attempts, force=True)


def build_response(change_number, appids):
    return SimpleNamespace(
        current_change_number=change_number,
        app_changes=[SimpleNamespace(appid=appid) for appid in appids],
    )


def test_get_changes_since_waits_for_auto_reconnect_before_polling():
    client = FakeClient(
        connected=False,
        wait_result=True,
        reconnect_result=False,
        responses=[build_response(123, [10, 20])],
    )
    fetcher = PICSFetcher(client, max_retries=2)

    result = fetcher.get_changes_since(120)

    assert result is not None
    assert result.change_number == 123
    assert result.app_changes == [10, 20]
    assert client.wait_calls == 1
    assert client.reconnect_calls == []


def test_get_changes_since_forces_manual_reconnect_after_auto_reconnect_timeout():
    client = FakeClient(
        connected=False,
        wait_result=False,
        reconnect_result=True,
        responses=[build_response(321, [42])],
    )
    fetcher = PICSFetcher(client, max_retries=2)

    result = fetcher.get_changes_since(300)

    assert result is not None
    assert result.change_number == 321
    assert result.app_changes == [42]
    assert client.wait_calls == 1
    assert client.reconnect_calls == [(fetcher.MANUAL_RECONNECT_ATTEMPTS, True)]


def test_get_changes_since_raises_when_reconnect_cannot_recover():
    client = FakeClient(connected=False, wait_result=False, reconnect_result=False)
    fetcher = PICSFetcher(client, max_retries=1)

    with pytest.raises(RuntimeError, match="Failed to get PICS changes: Failed to reconnect to Steam"):
        fetcher.get_changes_since(500)


def test_get_changes_since_retries_after_timeout_response(monkeypatch):
    client = FakeClient(
        connected=True,
        responses=[None, build_response(700, [11, 22])],
    )
    fetcher = PICSFetcher(client, timeout=1, max_retries=2)
    monkeypatch.setattr(pics_module.time, "sleep", lambda *_args, **_kwargs: None)

    result = fetcher.get_changes_since(650)

    assert result is not None
    assert result.change_number == 700
    assert result.app_changes == [11, 22]
    assert client.client.calls == 2


def test_get_changes_since_retries_after_hanging_poll_timeout(monkeypatch):
    def slow_success():
        gevent.sleep(0.05)
        return build_response(901, [99])

    client = FakeClient(
        connected=True,
        responses=[slow_success, build_response(902, [42])],
    )
    fetcher = PICSFetcher(client, timeout=1, change_poll_timeout=0.01, max_retries=2)
    monkeypatch.setattr(pics_module.time, "sleep", lambda *_args, **_kwargs: None)

    result = fetcher.get_changes_since(800)

    assert result is not None
    assert result.change_number == 902
    assert result.app_changes == [42]
    assert client.client.calls == 2
