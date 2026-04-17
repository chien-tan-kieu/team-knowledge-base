from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    llm_model: str = "claude-sonnet-4-6"
    knowledge_dir: Path = Path("knowledge")

    # Auth
    jwt_secret: str                                    # required, no default
    jwt_ttl_seconds: int = 86400                       # 24h
    allowed_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False                        # flip on in prod (HTTPS)

    # Compile prompt sizing — cap pages included as context to keep prompt bounded.
    compile_max_context_pages: int = 10

    # Observability
    log_level: str = "INFO"
    expose_api_docs: bool = True                       # /docs, /redoc, /openapi.json


settings = Settings()
