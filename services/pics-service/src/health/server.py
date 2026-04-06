"""HTTP health check server for Railway."""

import json
import logging
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Any, Dict, Optional

from ..config.settings import settings

logger = logging.getLogger(__name__)


class HealthHandler(BaseHTTPRequestHandler):
    """HTTP request handler for health checks."""

    # Class-level status storage
    _status: Dict[str, Any] = {"status": "starting", "health_state": "starting"}

    def do_GET(self):
        """Handle GET requests."""
        if self.path == "/" or self.path == "/health":
            code, message = self.get_health_response()
            self._send_response(code, message)
        elif self.path == "/status":
            self._send_json_response(200, self._status)
        else:
            self._send_response(404, "Not Found")

    @classmethod
    def get_health_response(cls) -> tuple[int, str]:
        """Map worker status to an HTTP health response."""
        if cls._status.get("status") == "error" or cls._status.get("health_state") == "unhealthy":
            return 503, "UNHEALTHY"
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

    def start(self):
        """Start the health check server in a background thread."""
        self._server = HTTPServer(("0.0.0.0", self._port), HealthHandler)

        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self._thread.start()

        logger.info(f"Health server listening on port {self._port}")
        HealthHandler._status.update({"status": "running", "health_state": "starting"})

    def stop(self):
        """Stop the health check server."""
        if self._server:
            self._server.shutdown()
            logger.info("Health server stopped")

    def update_status(self, data: Dict[str, Any]):
        """Update status information."""
        HealthHandler._status.update(data)
        HealthHandler._status["updated_at"] = self._get_timestamp()

    def _get_timestamp(self) -> str:
        """Get current timestamp as ISO string."""
        from datetime import datetime

        return datetime.utcnow().isoformat() + "Z"
