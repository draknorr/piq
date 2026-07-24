"""Main entry point for PICS service."""

import logging
import signal
import sys
from typing import Any, Optional

from .config.settings import resolve_pics_work_mode, settings
from .health.server import HealthServer
from .workers.bulk_sync import BulkSyncWorker
from .workers.change_history_backfill import ChangeHistoryBackfillWorker
from .workers.change_monitor import ChangeMonitorWorker
from .workers.durable_change_intake import DurableChangeIntakeWorker

# Global worker reference for signal handling
current_worker: Optional[Any] = None


def setup_logging():
    """Configure logging based on settings."""
    level = getattr(logging, settings.log_level.upper(), logging.INFO)

    if settings.log_json:
        # JSON format for Railway
        import json
        from datetime import datetime, timezone

        class JsonFormatter(logging.Formatter):
            def format(self, record):
                log_obj = {
                    "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                    "level": record.levelname,
                    "logger": record.name,
                    "message": record.getMessage(),
                }
                if record.exc_info:
                    log_obj["exception"] = self.formatException(record.exc_info)
                return json.dumps(log_obj)

        handler = logging.StreamHandler()
        handler.setFormatter(JsonFormatter())
        logging.root.handlers = [handler]
    else:
        # Simple format for development
        logging.basicConfig(
            level=level,
            format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        )

    logging.root.setLevel(level)


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    logging.info(f"Received signal {signum}, initiating shutdown")
    if current_worker and hasattr(current_worker, "stop"):
        current_worker.stop()
    sys.exit(0)


def main():
    """Main entry point."""
    global current_worker

    # Setup logging
    setup_logging()

    logger = logging.getLogger(__name__)
    logger.info(f"Starting PICS service in {settings.mode} mode")

    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    # Start health server
    health_server = HealthServer()
    health_server.start()

    try:
        if settings.mode == "bulk_sync":
            worker = BulkSyncWorker(health_server=health_server)
            result = worker.run()
            logger.info(f"Bulk sync completed: {result}")

        elif settings.mode == "first_pass":
            worker = BulkSyncWorker(health_server=health_server)
            result = worker.run_first_pass()
            logger.info(f"First-pass sync completed: {result}")

        elif settings.mode == "change_monitor":
            pics_work_mode = resolve_pics_work_mode(settings.pics_work_mode)
            logger.info("Selected PICS work mode: %s", pics_work_mode)
            if pics_work_mode == "legacy":
                if settings.pics_processing_enabled:
                    raise ValueError(
                        "PICS_PROCESSING_ENABLED cannot be used with the lossy legacy monitor"
                    )
                logger.warning(
                    "PICS_WORK_MODE=legacy uses the lossy in-memory queue and must not "
                    "be restarted as the production primary"
                )
                current_worker = ChangeMonitorWorker(health_server=health_server)
            else:
                current_worker = DurableChangeIntakeWorker(
                    work_mode=pics_work_mode,
                    health_server=health_server,
                )
            current_worker.run()

        elif settings.mode == "backfill_change_history":
            worker = ChangeHistoryBackfillWorker()
            result = worker.run()
            logger.info(f"Change-history backfill completed: {result}")

        else:
            logger.error(f"Unknown mode: {settings.mode}")
            sys.exit(1)

    except Exception as e:
        health_server.update_status(
            {
                "status": "error",
                "health_state": "unhealthy",
                "error": str(e),
            }
        )
        logger.exception(f"Fatal error: {e}")
        sys.exit(1)

    finally:
        health_server.stop()


if __name__ == "__main__":
    main()
