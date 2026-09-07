import sys

# ruff: noqa: E402 - tests add the service root before importing src
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config.settings import settings
from src.health.server import HealthHandler, HealthServer


def test_health_response_stays_ok_while_worker_is_degraded():
    original_status = dict(HealthHandler._status)

    try:
        HealthHandler._status = {
            "status": "running",
            "health_state": "degraded",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        assert HealthHandler.get_health_response() == (200, "OK")
    finally:
        HealthHandler._status = original_status


def test_stale_status_is_unhealthy_even_if_http_thread_is_responding(monkeypatch):
    monkeypatch.setattr(
        HealthHandler,
        "_status",
        {"status": "running", "health_state": "degraded", "updated_at": "2000-01-01T00:00:00Z"},
    )
    assert HealthHandler.get_health_response() == (503, "STALE")


def test_progress_deadline_is_exact_and_includes_startup(monkeypatch):
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(
        HealthHandler,
        "_status",
        {"status": "running", "health_state": "starting", "updated_at": now.isoformat()},
    )
    assert HealthHandler.get_health_response(now) == (200, "STARTING")
    assert HealthHandler.get_health_response(
        now + timedelta(seconds=settings.pics_progress_timeout_seconds)
    ) == (503, "STALE")


def test_responsive_source_block_does_not_trigger_watchdog(monkeypatch):
    monkeypatch.setattr(HealthHandler, "_status", {})
    server = HealthServer()
    server.update_status(
        {
            "status": "running",
            "health_state": "degraded",
            "source_complete": False,
            "last_poll_error": "source_blocked",
        }
    )
    # Addition followed by subtraction can round just below the exact deadline.
    server._last_progress_monotonic = 271.683480581
    assert not server.is_progress_stale(server._last_progress_monotonic + 1)
    assert HealthHandler.get_health_response() == (200, "OK")
    assert server.is_progress_stale(
        server._last_progress_monotonic + settings.pics_progress_timeout_seconds
    )


def test_missing_or_malformed_progress_is_unhealthy(monkeypatch):
    monkeypatch.setattr(HealthHandler, "_status", {"status": "running", "health_state": "degraded"})
    assert HealthHandler.get_health_response() == (503, "STALE")
    HealthHandler._status["updated_at"] = "invalid"
    assert HealthHandler.get_health_response() == (503, "STALE")


def test_health_response_fails_when_worker_is_unhealthy():
    original_status = dict(HealthHandler._status)

    try:
        HealthHandler._status = {"status": "running", "health_state": "unhealthy"}
        assert HealthHandler.get_health_response() == (503, "UNHEALTHY")
    finally:
        HealthHandler._status = original_status


def test_watchdog_exits_on_stalled_progress_without_refreshing_it(monkeypatch):
    from src.health import server as module

    health = HealthServer()
    health._last_progress_monotonic = 1
    health._stop_event = SimpleNamespace(wait=lambda _: False)
    monkeypatch.setattr(
        module.time, "monotonic", lambda: 1 + settings.pics_progress_timeout_seconds
    )
    events = []
    monkeypatch.setattr(module.faulthandler, "dump_traceback", lambda **_: events.append("stacks"))

    def exit_process(code):
        events.append(("exit", code))
        raise SystemExit(code)

    monkeypatch.setattr(module.os, "_exit", exit_process)
    with pytest.raises(SystemExit, match="1"):
        health._watchdog_loop()
    assert events == ["stacks", ("exit", 1)]
    assert health._last_progress_monotonic == 1


def test_watchdog_stop_does_not_exit(monkeypatch):
    health = HealthServer()
    health._stop_event.set()
    monkeypatch.setattr(health, "is_progress_stale", lambda: pytest.fail("stopped watchdog ran"))
    health._watchdog_loop()


def test_intake_progress_cannot_hide_stalled_processing(monkeypatch):
    from src.health import server as module

    now = datetime.now(timezone.utc)
    monkeypatch.setattr(HealthHandler, "_status", {})
    monkeypatch.setattr(module.time, "monotonic", lambda: 10)
    health = HealthServer()
    health.update_status(
        {
            "status": "running",
            "processing_in_flight": True,
            "last_processing_progress_at": now.isoformat(),
        }
    )
    late = 10 + settings.pics_progress_timeout_seconds
    monkeypatch.setattr(module.time, "monotonic", lambda: late)
    health.update_status({"last_change": 21})
    assert health.is_progress_stale(late)
    # Fresh HTTP/intake status still exposes the independently stale processor.
    HealthHandler._status["updated_at"] = (
        now + timedelta(seconds=settings.pics_progress_timeout_seconds)
    ).isoformat()
    assert HealthHandler.get_health_response(
        now + timedelta(seconds=settings.pics_progress_timeout_seconds)
    ) == (503, "PROCESSING_STALE")
    health.update_status({"last_processing_progress_at": datetime.now(timezone.utc).isoformat()})
    assert not health.is_progress_stale(late)
