from __future__ import annotations

import os
from datetime import date
from pathlib import Path
import sys

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION", "python")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.database.operations import select_first_pass_app_ids


def test_select_first_pass_app_ids_prioritizes_recent_release_then_near_release() -> None:
    rows = [
        {
            "appid": 10,
            "last_storefront_sync": "2026-03-27T10:00:00Z",
            "storefront_accessible": True,
            "apps": {"release_date": "2026-03-27", "is_released": True},
        },
        {
            "appid": 20,
            "last_storefront_sync": "2026-03-28T09:00:00Z",
            "storefront_accessible": True,
            "apps": {"release_date": "2026-04-03", "is_released": False},
        },
        {
            "appid": 30,
            "last_storefront_sync": "2026-03-28T08:00:00Z",
            "storefront_accessible": True,
            "apps": {"release_date": "2025-12-01", "is_released": True},
        },
        {
            "appid": 40,
            "last_storefront_sync": "2026-03-28T11:00:00Z",
            "storefront_accessible": False,
            "apps": {"release_date": "2026-03-28", "is_released": True},
        },
        {
            "appid": 50,
            "last_storefront_sync": None,
            "storefront_accessible": True,
            "apps": {"release_date": "2026-03-20", "is_released": True},
        },
    ]

    selected = select_first_pass_app_ids(
        rows,
        limit=3,
        recent_release_days=30,
        near_release_days=14,
        today=date(2026, 3, 28),
    )

    assert selected == [10, 20, 30]
