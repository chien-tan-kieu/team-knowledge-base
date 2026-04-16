from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    llm_model: str = "claude-sonnet-4-6"
    knowledge_dir: Path = Path("knowledge")


settings = Settings()
