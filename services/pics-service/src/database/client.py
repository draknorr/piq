"""Supabase client wrapper for PICS service."""

import logging
import os
from typing import Optional

from supabase import create_client, Client

from ..config.settings import settings

logger = logging.getLogger(__name__)

ALLOWED_SUPABASE_SERVICE_PURPOSES = {
    "auth",
    "legacy-read",
    "migration",
    "parity",
    "reference",
}


def _read_bool(value: Optional[str]) -> bool:
    return value is not None and value.strip().lower() in {"1", "true", "yes", "on"}


def _is_tiger_write_mode() -> bool:
    data_write_target = os.environ.get("DATA_WRITE_TARGET", "").strip().lower()
    if data_write_target == "tiger":
        return True

    return (
        settings.pics_change_history_target.strip().lower() == "tiger"
        and settings.pics_latest_state_target.strip().lower() == "tiger"
    )


def _assert_supabase_service_client_allowed() -> None:
    if not _is_tiger_write_mode():
        return

    purpose = os.environ.get("SUPABASE_SERVICE_CLIENT_PURPOSE", "").strip().lower()
    if purpose in ALLOWED_SUPABASE_SERVICE_PURPOSES:
        return

    if _read_bool(os.environ.get("ALLOW_SUPABASE_SERVICE_CLIENT_WITH_TIGER")):
        return

    raise ValueError(
        "Refusing to create a Supabase service-role client while the write target is tiger. "
        "Set SUPABASE_SERVICE_CLIENT_PURPOSE only for approved auth, legacy-read, "
        "reference, migration, or parity usage."
    )


class SupabaseClient:
    """Supabase client wrapper for PICS service."""

    _instance: Optional["SupabaseClient"] = None

    def __init__(self):
        self._client: Optional[Client] = None

    @classmethod
    def get_instance(cls) -> "SupabaseClient":
        """Get singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def connect(self) -> Client:
        """Initialize Supabase connection."""
        _assert_supabase_service_client_allowed()

        url = settings.supabase_url
        key = settings.supabase_service_key

        if not url or not key:
            raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY")

        self._client = create_client(url, key)
        logger.info("Connected to Supabase")
        return self._client

    @property
    def client(self) -> Client:
        """Get the Supabase client, connecting if needed."""
        if self._client is None:
            return self.connect()
        return self._client

    def disconnect(self):
        """Disconnect from Supabase (cleanup)."""
        self._client = None
        logger.info("Disconnected from Supabase")
