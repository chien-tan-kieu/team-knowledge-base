from pathlib import Path

from kb.config import Settings


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
    assert s.llm_model == "gemini/gemini-2.5-flash"


def test_compile_max_retries_defaults_to_one():
    s = _make_settings()
    assert s.compile_max_retries == 1
