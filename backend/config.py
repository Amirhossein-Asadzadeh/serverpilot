"""
ServerPilot Backend — Configuration

All settings are loaded from environment variables (12-factor app pattern).
Never hardcode secrets in source code.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:///./serverpilot.db"

    # JWT
    secret_key: str = "CHANGE-ME-USE-secrets.token-hex-32-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 8  # 8 hours

    # Panel
    panel_host: str = "0.0.0.0"
    panel_port: int = 8000
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    # Health check interval (seconds) — how often to ping all agents
    health_check_interval: int = 30

    # Default admin user created on first startup
    default_admin_username: str = "admin"
    default_admin_password: str = "changeme"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


settings = Settings()
