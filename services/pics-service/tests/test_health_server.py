from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.health.server import HealthHandler


def test_health_response_stays_ok_while_worker_is_degraded():
    original_status = dict(HealthHandler._status)

    try:
        HealthHandler._status = {"status": "running", "health_state": "degraded"}
        assert HealthHandler.get_health_response() == (200, "OK")
    finally:
        HealthHandler._status = original_status


def test_health_response_fails_when_worker_is_unhealthy():
    original_status = dict(HealthHandler._status)

    try:
        HealthHandler._status = {"status": "running", "health_state": "unhealthy"}
        assert HealthHandler.get_health_response() == (503, "UNHEALTHY")
    finally:
        HealthHandler._status = original_status
