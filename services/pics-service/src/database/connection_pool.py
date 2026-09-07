"""Bounded, lazily opened native-thread pools for durable PICS stores."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from threading import Lock
from typing import Any, Iterator

logger = logging.getLogger(__name__)


class PICSConnectionPool:
    """Own connections for one store role; never share an active checkout."""

    def __init__(
        self,
        database_url: str,
        *,
        application_name: str,
        max_size: int,
        statement_timeout_seconds: int = 60,
        lock_timeout_seconds: int = 10,
        wait_timeout_seconds: float = 10,
    ):
        if not 1 <= max_size <= 8:
            raise ValueError("PICS pool size must be between 1 and 8")
        self._database_url = database_url
        self._application_name = application_name
        self._max_size = max_size
        self._statement_ms = max(1, int(statement_timeout_seconds)) * 1000
        self._lock_ms = max(1, int(lock_timeout_seconds)) * 1000
        self._wait_timeout = max(0.01, float(wait_timeout_seconds))
        self._pool: Any = None
        self._closed = False
        self._lock = Lock()

    def _configure(self, connection: Any) -> None:
        # Both configure and reset must leave the connection outside a transaction.
        connection.autocommit = True
        try:
            connection.execute(
                "SELECT set_config('statement_timeout', %s, false), "
                "set_config('lock_timeout', %s, false), "
                "set_config('application_name', %s, false)",
                (str(self._statement_ms), str(self._lock_ms), self._application_name),
                prepare=False,
            )
        finally:
            connection.autocommit = False

    def _reset(self, connection: Any) -> None:
        from psycopg.rows import tuple_row

        # Pool return first commits/rolls back the caller's transaction. DISCARD
        # also clears temp tables, session advisory locks, role/GUC and LISTEN
        # state. Disable automatic preparation to avoid a stale client-side map.
        connection.autocommit = True
        try:
            connection.execute("DISCARD ALL", prepare=False)
        finally:
            connection.autocommit = False
        connection.isolation_level = None
        connection.read_only = None
        connection.deferrable = None
        connection.row_factory = tuple_row
        self._configure(connection)

    def _get_pool(self) -> Any:
        with self._lock:
            if self._closed:
                raise RuntimeError("PICS database pool is closed")
            if self._pool is None:
                from psycopg_pool import ConnectionPool

                self._pool = ConnectionPool(
                    self._database_url,
                    name=self._application_name,
                    kwargs={
                        "application_name": self._application_name,
                        "connect_timeout": 10,
                        "prepare_threshold": None,
                        "tcp_user_timeout": 10_000,
                        "keepalives": 1,
                        "keepalives_idle": 30,
                        "keepalives_interval": 10,
                        "keepalives_count": 3,
                    },
                    min_size=0,
                    max_size=self._max_size,
                    timeout=self._wait_timeout,
                    max_waiting=16,
                    max_idle=300,
                    max_lifetime=1800,
                    reconnect_timeout=30,
                    num_workers=1,
                    configure=self._configure,
                    check=ConnectionPool.check_connection,
                    open=True,
                )
            return self._pool

    @contextmanager
    def connection(self) -> Iterator[Any]:
        pool = self._get_pool()
        connection = pool.getconn(timeout=self._wait_timeout)
        try:
            with connection:
                yield connection
        finally:
            # Reset synchronously while this thread still owns the checkout.
            # A queued background reset can be discarded during pool.close(),
            # leaving an externally referenced connection open until GC.
            try:
                if not connection.closed:
                    if self._closed:
                        connection.close()
                    else:
                        try:
                            self._reset(connection)
                        except Exception:
                            # The caller's transaction has already committed or
                            # rolled back. Discard the session without turning a
                            # successful commit into an ambiguous retry.
                            logger.warning("Discarding PICS connection after reset failure")
                            connection.close()
            finally:
                pool.putconn(connection)

    def get_stats(self) -> dict[str, int]:
        with self._lock:
            return self._pool.get_stats() if self._pool is not None else {}

    def close(self) -> None:
        with self._lock:
            self._closed = True
            pool = self._pool
        if pool is not None:
            # Checked-out connections remain owned until returned; close never
            # steals a transaction from another native thread.
            pool.close(timeout=5)
