"""Single-owner governor for every Steam CM request made by PICS."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from threading import Lock, Semaphore
from typing import Any, Callable, Optional

try:
    import gevent
    from gevent.lock import Semaphore as GeventSemaphore
except ImportError:  # pragma: no cover - production installs gevent
    gevent = None
    GeventSemaphore = None


class SteamRequestQueueFullError(RuntimeError):
    """The bounded Steam request queue cannot accept more work."""


class SteamCircuitOpenError(RuntimeError):
    """Steam requests are paused after repeated upstream failures."""


@dataclass(frozen=True)
class SteamRequestPolicy:
    min_interval_seconds: float = 0.5
    queue_capacity: int = 500
    max_attempts: int = 5
    backoff_base_seconds: float = 1.0
    backoff_max_seconds: float = 30.0
    backoff_jitter_ratio: float = 0.25
    circuit_failure_threshold: int = 5
    circuit_cooldown_seconds: float = 60.0

    def __post_init__(self) -> None:
        if not 0 < float(self.min_interval_seconds) <= 60:
            raise ValueError("Steam request spacing must be between 0 and 60 seconds")
        if not 1 <= int(self.queue_capacity) <= 10_000:
            raise ValueError("Steam request queue capacity must be between 1 and 10000")
        if not 1 <= int(self.max_attempts) <= 10:
            raise ValueError("Steam request attempts must be between 1 and 10")
        if not 0 <= float(self.backoff_base_seconds) <= 60:
            raise ValueError("Steam request base backoff must be between 0 and 60 seconds")
        if not float(self.backoff_base_seconds) <= float(self.backoff_max_seconds) <= 300:
            raise ValueError("Steam request max backoff must be between base and 300 seconds")
        if not 0 <= float(self.backoff_jitter_ratio) <= 1:
            raise ValueError("Steam request jitter ratio must be between 0 and 1")
        if not 1 <= int(self.circuit_failure_threshold) <= 100:
            raise ValueError("Steam circuit threshold must be between 1 and 100")
        if not 1 <= float(self.circuit_cooldown_seconds) <= 900:
            raise ValueError("Steam circuit cooldown must be between 1 and 900 seconds")


class SteamRequestScheduler:
    """Serialize, rate-govern, retry, and circuit-break one Steam session."""

    def __init__(
        self,
        policy: SteamRequestPolicy,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Optional[Callable[[float], None]] = None,
        random_value: Callable[[], float] = random.random,
    ):
        self._policy = policy
        self._monotonic = monotonic
        self._sleep = sleep or (gevent.sleep if gevent is not None else time.sleep)
        self._random = random_value
        self._slot = GeventSemaphore(1) if GeventSemaphore is not None else Semaphore(1)
        self._queue_lock = Lock()
        self._pending = 0
        self._last_started_at: Optional[float] = None
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0

    def execute(self, request_name: str, operation: Callable[[], Any]) -> Any:
        """Run one request within the shared bounded queue and policy."""

        with self._queue_lock:
            if self._pending >= max(1, int(self._policy.queue_capacity)):
                raise SteamRequestQueueFullError(
                    f"Steam request queue is full while scheduling {request_name}"
                )
            self._pending += 1

        try:
            with self._slot:
                return self._execute_locked(request_name, operation)
        finally:
            with self._queue_lock:
                self._pending -= 1

    def _execute_locked(self, request_name: str, operation: Callable[[], Any]) -> Any:
        now = self._monotonic()
        if now < self._circuit_open_until:
            raise SteamCircuitOpenError(f"Steam request circuit is open for {request_name}")

        attempts = max(1, int(self._policy.max_attempts))
        last_error: Optional[BaseException] = None
        for attempt in range(attempts):
            self._wait_for_governor_slot()
            try:
                result = operation()
                self._consecutive_failures = 0
                self._circuit_open_until = 0.0
                return result
            except Exception as error:
                last_error = error
                self._consecutive_failures += 1
                if self._consecutive_failures >= max(
                    1, int(self._policy.circuit_failure_threshold)
                ):
                    self._circuit_open_until = self._monotonic() + max(
                        1.0, float(self._policy.circuit_cooldown_seconds)
                    )
                    break
                if attempt < attempts - 1:
                    self._sleep(self._backoff_seconds(attempt))

        if self._monotonic() < self._circuit_open_until:
            raise SteamCircuitOpenError(
                f"Steam request circuit opened after {request_name} failures"
            ) from last_error
        if last_error is not None:
            raise last_error
        raise RuntimeError(f"Steam request {request_name} did not execute")

    def _wait_for_governor_slot(self) -> None:
        now = self._monotonic()
        if self._last_started_at is not None:
            remaining = max(
                0.0,
                float(self._policy.min_interval_seconds) - (now - self._last_started_at),
            )
            if remaining > 0:
                self._sleep(remaining)
        self._last_started_at = self._monotonic()

    def _backoff_seconds(self, attempt: int) -> float:
        base = min(
            max(0.0, float(self._policy.backoff_base_seconds)) * (2**attempt),
            max(0.0, float(self._policy.backoff_max_seconds)),
        )
        jitter_ratio = min(1.0, max(0.0, float(self._policy.backoff_jitter_ratio)))
        jitter = base * jitter_ratio * ((self._random() * 2.0) - 1.0)
        return max(0.0, base + jitter)

    @property
    def pending(self) -> int:
        return self._pending

    @property
    def circuit_open_until(self) -> float:
        return self._circuit_open_until
