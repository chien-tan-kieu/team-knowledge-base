from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_model: str = "claude-sonnet-4-6"
    knowledge_dir: Path = Path("knowledge")

    # Auth
    jwt_secret: str                                    # required, no default
    jwt_ttl_seconds: int = 86400                       # 24h
    allowed_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False                        # flip on in prod (HTTPS)

    # Minimum ratio of compile output chars (summary + body) to raw input chars.
    # Below this we assume the LLM over-summarized and fail the ingest.
    compile_min_coverage: float = 0.7

    # Set false to skip the verbatim code-block/table check (useful with weaker models).
    compile_require_verbatim: bool = True

    # Observability
    log_level: str = "INFO"
    expose_api_docs: bool = True                       # /docs, /redoc, /openapi.json


settings = Settings()
