"""Application settings from environment variables."""

from typing import Optional

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Database
    supabase_url: Optional[str] = None
    supabase_service_key: Optional[str] = None
    tiger_primary_url: Optional[str] = None

    # PICS product data is Tiger/R2-primary. The Supabase value remains only for
    # explicit legacy compatibility and is never used by durable intake.
    pics_change_history_target: str = "tiger"  # 'tiger' or legacy 'supabase'
    pics_change_history_tiger_url: Optional[str] = None

    # PICS latest-state storage for apps, relationships, sync status, and the
    # legacy cursor. Supabase is an explicit legacy compatibility target only.
    pics_latest_state_target: str = "tiger"  # 'tiger' or legacy 'supabase'
    pics_latest_state_tiger_url: Optional[str] = None

    # One-time PICS change-history backfill controls.
    pics_change_history_backfill_batch_size: int = 500
    pics_change_history_backfill_limit: Optional[int] = None
    pics_change_history_backfill_min_id: int = 0
    pics_change_history_backfill_dry_run: bool = True
    pics_change_history_backfill_surfaces: str = "snapshots,events"

    # Steam (optional - for authenticated requests)
    steam_username: Optional[str] = None
    steam_password: Optional[str] = None

    # Service configuration
    mode: str = "change_monitor"  # 'bulk_sync', 'first_pass', or 'change_monitor'
    port: int = 8080

    # Bulk sync options
    bulk_batch_size: int = 200
    bulk_request_delay: float = 0.5
    bulk_timeout: int = 60  # Timeout per batch fetch (seconds)
    bulk_max_retries: int = 5  # Retry attempts per batch
    first_pass_batch_limit: int = 500
    first_pass_candidate_pool_size: int = 1000
    first_pass_recent_release_days: int = 30
    first_pass_near_release_days: int = 14

    # Change monitor options
    poll_interval: int = 30
    process_batch_size: int = 100
    max_queue_size: int = 10000
    # Required when MODE=change_monitor. Missing or unknown values fail closed
    # instead of silently restarting the lossy legacy monitor.
    pics_work_mode: Optional[str] = None  # 'legacy', 'shadow', or 'durable'
    pics_intake_tiger_url: Optional[str] = None
    pics_intake_stream_key: str = "shadow-default"
    pics_intake_lane: str = "live"  # 'live' or 'catchup'
    pics_shadow_start_change_number: Optional[int] = None
    pics_intake_statement_timeout_seconds: int = 60
    pics_intake_lock_timeout_seconds: int = 10
    # Leased processing remains disabled until a separately approved shadow
    # runtime. Intake can be validated without enabling payload promotion.
    pics_processing_enabled: bool = False
    pics_consumer_worker_id: Optional[str] = None
    pics_consumer_live_batch_size: int = 40
    pics_consumer_catchup_batch_size: int = 10
    pics_consumer_lease_seconds: int = 300
    pics_consumer_retry_base_seconds: int = 30
    pics_consumer_retry_max_seconds: int = 3600

    # Steam connection settings
    steam_heartbeat_interval: int = 300  # 5 minutes - heartbeat to prevent idle disconnect
    steam_auto_reconnect: bool = True  # Auto-reconnect on disconnect

    # Logging
    log_level: str = "INFO"
    log_json: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        extra = "ignore"


settings = Settings()


def resolve_pics_work_mode(value: Optional[str]) -> str:
    """Normalize an explicit PICS work mode or fail closed."""

    normalized = (value or "").strip().lower()
    if normalized not in {"legacy", "shadow", "durable"}:
        raise ValueError(
            "MODE=change_monitor requires explicit PICS_WORK_MODE=legacy|shadow|durable"
        )
    return normalized
