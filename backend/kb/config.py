from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    llm_model: str = "gemini/gemini-flash-latest"
    compile_model: str | None = None
    query_model: str | None = None
    knowledge_dir: Path                          # required — no default; set in .env
    schema_dir: Path = Path("schema")            # relative to backend/ working dir

    # Auth
    jwt_secret: str
    jwt_ttl_seconds: int = 86400
    allowed_origins: list[str] = ["http://localhost:5173"]
    cookie_secure: bool = False

    compile_min_coverage: float = 0.7
    compile_require_verbatim: bool = True
    compile_max_retries: int = 1

    log_level: str = "INFO"
    expose_api_docs: bool = True

    @property
    def effective_compile_model(self) -> str:
        return self.compile_model or self.llm_model

    @property
    def effective_query_model(self) -> str:
        return self.query_model or self.llm_model


settings = Settings()
