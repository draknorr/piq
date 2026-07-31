# ruff: noqa: E402, I001

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
    def __init__(
        self, *, connected=False, wait_result=False, reconnect_result=False, responses=None
    ):
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


class FakeTokenClient(FakeClient):
    def __init__(self, *, token_responses, product_responses):
        super().__init__(connected=True)
        self.token_responses = list(token_responses)
        self.product_responses = list(product_responses)
        self.token_calls = []
        self.product_calls = []
        self.expired = []

    def acquire_access_tokens(self, appids, force_refresh=False):
        self.token_calls.append((list(appids), force_refresh))
        response = self.token_responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def request_product_info(self, apps, timeout):
        self.product_calls.append((apps, timeout))
        response = self.product_responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def expire_access_token(self, appid):
        self.expired.append(appid)


def build_response(
    change_number,
    appids,
    *,
    since_change_number=0,
    force_full_update=False,
    force_full_app_update=False,
    force_full_package_update=False,
):
    return SimpleNamespace(
        current_change_number=change_number,
        since_change_number=since_change_number,
        app_changes=[
            SimpleNamespace(
                appid=appid,
                change_number=change_number,
                needs_token=False,
            )
            for appid in appids
        ],
        force_full_update=force_full_update,
        force_full_app_update=force_full_app_update,
        force_full_package_update=force_full_package_update,
    )


def test_get_changes_since_waits_for_auto_reconnect_before_polling():
    client = FakeClient(
        connected=False,
        wait_result=True,
        reconnect_result=False,
        responses=[build_response(123, [10, 20], since_change_number=120)],
    )
    fetcher = PICSFetcher(client, max_retries=2)

    result = fetcher.get_changes_since(120)

    assert result is not None
    assert result.change_number == 123
    assert result.app_changes == [10, 20]
    assert result.since_change_number == 120
    assert [change.change_number for change in result.app_change_details] == [123, 123]
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

    with pytest.raises(
        RuntimeError, match="Failed to get PICS changes: Failed to reconnect to Steam"
    ):
        fetcher.get_changes_since(500)


def test_get_changes_since_retries_after_timeout_response(monkeypatch):
    client = FakeClient(
        connected=True,
        responses=[None, build_response(700, [11, 22])],
    )
    fetcher = PICSFetcher(client, timeout=1, max_retries=2)
    monkeypatch.setattr(
        pics_module,
        "_cooperative_sleep",
        lambda *_args, **_kwargs: None,
    )

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
    monkeypatch.setattr(
        pics_module,
        "_cooperative_sleep",
        lambda *_args, **_kwargs: None,
    )

    result = fetcher.get_changes_since(800)

    assert result is not None
    assert result.change_number == 902
    assert result.app_changes == [42]
    assert client.client.calls == 2


def test_token_required_fetch_acquires_and_attaches_redacted_provenance():
    client = FakeTokenClient(
        token_responses=[
            (
                {5005180: 987654321},
                {5005180: {"needsToken": True, "status": "acquired"}},
            )
        ],
        product_responses=[
            {
                "apps": {
                    5005180: {
                        "appid": 5005180,
                        "_missing_token": False,
                        "access_token": 987654321,
                        "common": {
                            "name": "Checkmate in 3",
                            "accessToken": "987654321",
                        },
                    }
                }
            }
        ],
    )

    payload = PICSFetcher(client).fetch_token_required_apps([5005180])[5005180]

    assert client.product_calls[0][0] == [{"appid": 5005180, "access_token": 987654321}]
    assert payload["_missing_token"] is False
    assert payload["_token_request"] == {
        "needsToken": True,
        "status": "acquired",
    }
    assert "access_token" not in payload
    assert "accessToken" not in payload["common"]
    assert "987654321" not in str(payload)


def test_token_required_fetch_refreshes_once_after_rejection():
    client = FakeTokenClient(
        token_responses=[
            ({7: 111}, {7: {"needsToken": True, "status": "cached"}}),
            ({7: 222}, {7: {"needsToken": True, "status": "acquired"}}),
        ],
        product_responses=[
            {"apps": {7: {"appid": 7, "_missing_token": True}}},
            {"apps": {7: {"appid": 7, "_missing_token": False}}},
        ],
    )

    payload = PICSFetcher(client).fetch_token_required_apps([7])[7]

    assert client.token_calls == [([7], False), ([7], True)]
    assert client.expired == [7]
    assert client.product_calls[1][0] == [{"appid": 7, "access_token": 222}]
    assert payload["_missing_token"] is False


def test_token_acquisition_failure_is_retryable_not_source_blocked():
    client = FakeTokenClient(
        token_responses=[RuntimeError("Steam unavailable")],
        product_responses=[],
    )

    with pytest.raises(RuntimeError, match="Steam unavailable"):
        PICSFetcher(client).fetch_token_required_apps([7])


def test_token_unavailable_is_explicit_source_block_evidence():
    client = FakeTokenClient(
        token_responses=[({}, {7: {"needsToken": True, "status": "unavailable"}})],
        product_responses=[],
    )

    payload = PICSFetcher(client).fetch_token_required_apps([7])[7]

    assert payload == {
        "appid": 7,
        "_missing_token": True,
        "_token_request": {"needsToken": True, "status": "unavailable"},
    }
