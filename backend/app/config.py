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
    github_token: str = ""
    github_api_url: str = "https://api.github.com"


settings = Settings()
