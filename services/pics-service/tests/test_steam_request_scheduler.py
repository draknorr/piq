import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.steam.request_scheduler import (  # noqa: E402
    SteamCircuitOpenError,
    SteamRequestPolicy,
    SteamRequestQueueFullError,
    SteamRequestScheduler,
)


class FakeClock:
    def __init__(self):
        self.now = 0.0
        self.sleeps = []

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.now += seconds


def test_scheduler_serial_policy_retries_with_governor_and_jittered_backoff():
    clock = FakeClock()
    calls = []
    scheduler = SteamRequestScheduler(
        SteamRequestPolicy(
            min_interval_seconds=2,
            max_attempts=3,
            backoff_base_seconds=4,
            backoff_max_seconds=20,
            backoff_jitter_ratio=0.25,
            circuit_failure_threshold=10,
        ),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
        random_value=lambda: 1.0,
    )

    def request():
        calls.append(clock.now)
        if len(calls) < 3:
            raise RuntimeError("transient")
        return "ok"

    assert scheduler.execute("product_info", request) == "ok"
    assert calls == [0.0, 5.0, 15.0]
    assert clock.sleeps == [5.0, 10.0]
    assert scheduler.pending == 0


def test_scheduler_opens_and_half_opens_the_circuit():
    clock = FakeClock()
    scheduler = SteamRequestScheduler(
        SteamRequestPolicy(
            min_interval_seconds=0.01,
            max_attempts=5,
            backoff_base_seconds=0,
            circuit_failure_threshold=2,
            circuit_cooldown_seconds=30,
        ),
        monotonic=clock.monotonic,
        sleep=clock.sleep,
        random_value=lambda: 0.5,
    )

    with pytest.raises(SteamCircuitOpenError):
        scheduler.execute("changes", lambda: (_ for _ in ()).throw(RuntimeError("down")))
    with pytest.raises(SteamCircuitOpenError):
        scheduler.execute("heartbeat", lambda: "should not run")

    clock.now = 31.0
    assert scheduler.execute("half_open", lambda: "recovered") == "recovered"
    assert scheduler.circuit_open_until == 0.0


def test_scheduler_never_converts_process_control_exceptions_into_retries():
    scheduler = SteamRequestScheduler(
        SteamRequestPolicy(max_attempts=5),
        sleep=lambda _seconds: None,
    )
    calls = 0

    def stop():
        nonlocal calls
        calls += 1
        raise KeyboardInterrupt()

    with pytest.raises(KeyboardInterrupt):
        scheduler.execute("shutdown", stop)
    assert calls == 1


def test_scheduler_rejects_work_beyond_the_bounded_queue():
    scheduler = SteamRequestScheduler(SteamRequestPolicy(queue_capacity=1))
    scheduler._pending = 1

    with pytest.raises(SteamRequestQueueFullError):
        scheduler.execute("overflow", lambda: "must not run")


def test_scheduler_rejects_unbounded_or_disabled_policy_values():
    with pytest.raises(ValueError, match="spacing"):
        SteamRequestPolicy(min_interval_seconds=0)
    with pytest.raises(ValueError, match="capacity"):
        SteamRequestPolicy(queue_capacity=10_001)
    with pytest.raises(ValueError, match="attempts"):
        SteamRequestPolicy(max_attempts=11)
