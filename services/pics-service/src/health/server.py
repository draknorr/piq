"""HTTP health check server for Railway."""

import faulthandler
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional

from ..config.settings import settings

logger = logging.getLogger(__name__)


class HealthHandler(BaseHTTPRequestHandler):
    """HTTP request handler for health checks."""

    # Class-level status storage
    _status: Dict[str, Any] = {"status": "starting", "health_state": "starting"}

    def do_GET(self):  # noqa: N802 - BaseHTTPRequestHandler protocol method
        """Handle GET requests."""
        if self.path == "/" or self.path == "/health":
            code, message = self.get_health_response()
            self._send_response(code, message)
        elif self.path == "/status":
            self._send_json_response(200, self.get_status_response())
        else:
            self._send_response(404, "Not Found")

    @classmethod
    def get_status_response(cls, now: Optional[datetime] = None) -> Dict[str, Any]:
        """Report current liveness without rewriting the last worker observation."""
        code, reason = cls.get_health_response(now)
        status = {**cls._status, "health_http_status": code, "health_reason": reason}
        if code != 200:
            status["reported_health_state"] = status.get("health_state")
            status["health_state"] = "unhealthy"
        return status

    @classmethod
    def get_health_response(cls, now: Optional[datetime] = None) -> tuple[int, str]:
        """Map worker status to an HTTP health response."""
        if cls._status.get("status") == "error" or cls._status.get("health_state") == "unhealthy":
            return 503, "UNHEALTHY"
        timestamp = cls._status.get("updated_at")
        if timestamp is not None:
            try:
                updated_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                if updated_at.tzinfo is None:
                    updated_at = updated_at.replace(tzinfo=timezone.utc)
                age = ((now or datetime.now(timezone.utc)) - updated_at).total_seconds()
                if age >= max(1, settings.pics_progress_timeout_seconds) or age < -60:
                    return 503, "STALE"
            except (TypeError, ValueError):
                return 503, "STALE"
        elif cls._status.get("health_state") != "starting":
            return 503, "STALE"
        if cls._status.get("processing_in_flight"):
            try:
                progress = datetime.fromisoformat(
                    str(cls._status.get("last_processing_progress_at")).replace("Z", "+00:00")
                )
                age = ((now or datetime.now(timezone.utc)) - progress).total_seconds()
                if age >= max(1, settings.pics_progress_timeout_seconds) or age < -60:
                    return 503, "PROCESSING_STALE"
            except (TypeError, ValueError):
                return 503, "PROCESSING_STALE"
        if cls._status.get("health_state") == "starting":
            return 200, "STARTING"
        return 200, "OK"

    def _send_response(self, code: int, message: str):
        """Send a simple text response."""
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(message.encode())

    def _send_json_response(self, code: int, data: Dict[str, Any]):
        """Send a JSON response."""
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        """Suppress default logging."""
        pass


class HealthServer:
    """
    Simple HTTP server for Railway health checks.

    Railway expects a 200 response on the configured PORT.
    """

    def __init__(self, port: Optional[int] = None):
        self._port = port or settings.port
        self._server: Optional[HTTPServer] = None
        self._thread: Optional[threading.Thread] = None
        self._watchdog_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._last_progress_monotonic = time.monotonic()
        self._processing_progress_value: Optional[str] = None
        self._processing_progress_monotonic: Optional[float] = None

    def start(self):
        """Start the health check server in a background thread."""
        self._stop_event.clear()
        self.update_status({"status": "running", "health_state": "starting"})
        self._server = HTTPServer(("0.0.0.0", self._port), HealthHandler)

        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

        logger.info(f"Health server listening on port {self._port}")
        if settings.pics_watchdog_enabled:
            self._watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
            self._watchdog_thread.start()

    def stop(self):
        """Stop the health check server."""
        self._stop_event.set()
        if self._server:
            self._server.shutdown()
            logger.info("Health server stopped")

    def update_status(self, data: Dict[str, Any]):
        """Update status information."""
        HealthHandler._status = {
            **HealthHandler._status,
            **data,
            "updated_at": self._get_timestamp(),
        }
        self._last_progress_monotonic = time.monotonic()
        if not HealthHandler._status.get("processing_in_flight"):
            self._processing_progress_monotonic = None
            self._processing_progress_value = None
        else:
            progress = HealthHandler._status.get("last_processing_progress_at")
            if (
                progress != self._processing_progress_value
                or self._processing_progress_monotonic is None
            ):
                self._processing_progress_value = progress
                self._processing_progress_monotonic = time.monotonic()

    def is_progress_stale(self, now_monotonic: Optional[float] = None) -> bool:
        now = time.monotonic() if now_monotonic is None else now_monotonic
        deadline = max(1, settings.pics_progress_timeout_seconds)
        return now >= self._last_progress_monotonic + deadline or (
            self._processing_progress_monotonic is not None
            and now >= self._processing_progress_monotonic + deadline
        )

    def _watchdog_loop(self):
        # This native thread detects a blocked coordinator even when a gevent
        # timeout cannot interrupt native I/O. Never refresh progress here.
        while not self._stop_event.wait(5):
            if self.is_progress_stale():
                logger.critical(
                    "PICS coordinator stopped reporting progress; dumping stacks and exiting"
                )
                faulthandler.dump_traceback(all_threads=True)
                # Closing the process drops DB sessions (uncommitted work rolls
                # back); accepted batches remain durable and replay-idempotent.
                os._exit(1)

    def _get_timestamp(self) -> str:
        """Get current timestamp as ISO string."""
        from datetime import datetime

        return datetime.utcnow().isoformat() + "Z"
