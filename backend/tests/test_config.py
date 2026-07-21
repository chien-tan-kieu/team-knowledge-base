from pathlib import Path

import pytest

from kb.config import Settings


@pytest.fixture(autouse=True)
def _isolate_model_env(monkeypatch):
    # Importing litellm elsewhere in the suite triggers its own load_dotenv(),
    # which writes backend/.env's LLM_MODEL into os.environ for the rest of the
    # process — pydantic-settings reads os.environ regardless of _env_file, so
    # these default-value assertions would otherwise depend on test order.
    monkeypatch.delenv("LLM_MODEL", raising=False)
    monkeypatch.delenv("COMPILE_MODEL", raising=False)
    monkeypatch.delenv("QUERY_MODEL", raising=False)


def _make_settings(**overrides) -> Settings:
    base = dict(
        knowledge_dir=Path("/tmp/kb"),
        jwt_secret="test-secret",
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)


def test_effective_models_fall_back_to_llm_model():
    s = _make_settings(llm_model="gemini/gemini-2.5-flash")
    assert s.effective_compile_model == "gemini/gemini-2.5-flash"
    assert s.effective_query_model == "gemini/gemini-2.5-flash"


def test_explicit_task_models_win():
    s = _make_settings(
        llm_model="gemini/gemini-2.5-flash",
        compile_model="anthropic/claude-haiku-4-5",
        query_model="gemini/gemini-2.5-flash-lite",
    )
    assert s.effective_compile_model == "anthropic/claude-haiku-4-5"
    assert s.effective_query_model == "gemini/gemini-2.5-flash-lite"


def test_default_model_is_gemini_flash():
    s = _make_settings()
    assert s.llm_model == "gemini/gemini-flash-latest"


def test_compile_max_retries_defaults_to_one():
    s = _make_settings()
    assert s.compile_max_retries == 1


def test_raw_dir_defaults_to_project_relative_path_independent_of_knowledge_dir():
    s = _make_settings(knowledge_dir=Path("/some/obsidian/vault"))
    assert s.raw_dir == Path("knowledge/raw")
