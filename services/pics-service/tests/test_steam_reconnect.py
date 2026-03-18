from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.steam.pics import PICSFetcher


class FakeSteamApiClient:
    def __init__(self, responses=None):
        self.responses = list(responses or [])
        self.calls = 0

    def get_changes_since(self, *_args, **_kwargs):
        self.calls += 1
        if self.responses:
            response = self.responses.pop(0)
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
