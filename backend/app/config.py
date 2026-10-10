from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(ROOT / ".env"), extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./maw.db"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "dev-only-change-me-to-a-long-random-secret"
    jwt_expire_hours: int = 72
    frontend_url: str = "http://localhost:3000"
    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"
    xai_api_key: str = ""
    xai_model: str = "grok-3-mini"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-flash-latest"
    gemini_fallback_model: str = "gemini-flash-lite-latest"  # used after a 429/503 from the main model
    llm_fallback_model: str = ""  # overrides the per-provider fallback
    llm_provider: str = "auto"  # auto | openai | xai | gemini
    llm_base_url: str = ""  # optional override for any OpenAI-compatible endpoint
    llm_mode: str = "auto"  # auto | mock | live (openai accepted as alias for live)
    llm_timeout_seconds: float = 90  # thinking models (Gemini 3.x) often take 20-40s per call
    llm_retries: int = 3
    agent_step_delay: float = 0.05
    approval_timeout_seconds: float = 300
    sandbox_mode: str = "auto"  # auto (docker, else local in dev / mock in prod) | docker | local | mock
    agent_fix_attempts: int = 1  # live LLM only: rewrite + rerun after failing tests
    sandbox_image: str = "python:3.12-slim"
    sandbox_memory: str = "256m"
    sandbox_cpus: str = "0.5"
    sandbox_timeout_seconds: float = 20
    notify_webhook_url: str = ""  # Slack-compatible incoming webhook: approvals, handoffs, @mentions
    github_token: str = ""
    github_api_url: str = "https://api.github.com"

    environment: str = "development"  # development | production
    log_level: str = "INFO"
    log_format: str = "text"  # text | json
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    # api: runs execute inside the API process. worker: API only queues; `python -m app.worker` executes.
    agent_runner: str = "api"
    # Seconds a worker may go silent before another process may adopt its runs.
    worker_lease_seconds: float = 15
    worker_metrics_port: int = 9100
    # create_all on startup. Production uses `alembic upgrade head` instead.
    db_auto_create: bool = True
    cors_origins: str = ""  # comma-separated, in addition to FRONTEND_URL
    metrics_token: str = ""  # when set, /metrics requires `Authorization: Bearer <token>`

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    def allowed_origins(self) -> list[str]:
        origins = [self.frontend_url, *self.cors_origins.split(",")]
        if not self.is_production:
            origins.append("http://localhost:3000")
        return sorted({item.strip().rstrip("/") for item in origins if item.strip()})


settings = Settings()
