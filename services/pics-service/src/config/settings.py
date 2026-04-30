"""Application settings from environment variables."""

from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Database
    supabase_url: Optional[str] = None
    supabase_service_key: Optional[str] = None
    tiger_primary_url: Optional[str] = None

    # PICS change-history storage. This only controls app_source_snapshots and
    # app_change_events writes for source='pics'; latest-state PICS writes still
    # use Supabase in the current phase.
    pics_change_history_target: str = "supabase"  # 'supabase' or 'tiger'
    pics_change_history_tiger_url: Optional[str] = None

    # PICS latest-state storage for apps, relationships, sync status, and the
    # PICS cursor. Supabase remains the default until the Tiger bootstrap SQL is
    # applied and the Railway service env is flipped.
    pics_latest_state_target: str = "supabase"  # 'supabase' or 'tiger'
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
