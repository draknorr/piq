"""Application settings from environment variables."""

from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings from environment variables."""

    # Database
    supabase_url: str
    supabase_service_key: str

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
