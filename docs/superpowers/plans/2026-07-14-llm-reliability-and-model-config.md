# LLM Reliability & Model Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the KB's LLM pipeline reliable on cheap cloud models (Gemini 2.5 Flash default) by adding per-task model config, structured slug selection in QueryAgent Phase 1, and a retry-with-feedback loop in CompileAgent.

**Architecture:** All changes are in `backend/kb/`. A shared `kb/agents/structured.py` provides provider-appropriate structured-output kwargs (already handles Ollama vs frontier). `Settings` gains optional `compile_model` / `query_model` with `llm_model` fallback. QueryAgent Phase 1 requests JSON and falls back to comma-splitting. CompileAgent turns its validation gates into a feedback-driven retry loop.

**Tech Stack:** Python 3.12, FastAPI, LiteLLM, Pydantic v2, pytest (`asyncio_mode=auto`), uv.

**Spec:** `docs/superpowers/specs/2026-07-14-llm-reliability-and-model-config-design.md`

## Global Constraints

- Work on the existing branch `feature/obsidian-rag-integration` — do not create a new branch or worktree.
- All commands run from `backend/`. Use `uv run pytest ...` and `uv run ruff check .` (cross-platform; the repo runs on Windows where `.venv/bin/` does not exist).
- New default model string: `gemini/gemini-2.5-flash` (exact LiteLLM id).
- Public error contract unchanged: callers of `CompileAgent.compile` and `QueryAgent.query` still see `kb.errors.LLMUpstreamError` with the same user-facing message texts as today.
- Frontend, `LintAgent`, and the citations contract are out of scope — do not touch them.
- TDD is mandatory (project constitution): each task writes its failing test first and runs it before implementing.

---

### Task 1: Per-task model settings

**Files:**
- Modify: `backend/kb/config.py`
- Create: `backend/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.effective_compile_model: str` (property), `Settings.effective_query_model: str` (property), `Settings.compile_max_retries: int` (default 1), new optional fields `compile_model: str | None`, `query_model: str | None`, and new `llm_model` default `"gemini/gemini-2.5-flash"`. Tasks 5–6 rely on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_config.py`:

```python
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
```

Note: `_make_settings` passes values as constructor kwargs, which outrank any
`LLM_MODEL` env var the developer may have exported — except in
`test_default_model_is_gemini_flash`, which reads the field default. If that
test fails locally with a different model string, check for a stray
`LLM_MODEL` in the shell environment before touching code.

- [ ] **Step 2: Run tests to verify they fail**

Run (from `backend/`): `uv run pytest tests/test_config.py -v`
Expected: FAIL — `test_effective_models_fall_back_to_llm_model` etc. with `AttributeError: 'Settings' object has no attribute 'effective_compile_model'`, and `test_default_model_is_gemini_flash` with `assert 'claude-sonnet-4-6' == 'gemini/gemini-2.5-flash'`.

- [ ] **Step 3: Implement the settings**

In `backend/kb/config.py`, replace the line

```python
    llm_model: str = "claude-sonnet-4-6"
```

with

```python
    llm_model: str = "gemini/gemini-2.5-flash"
    compile_model: str | None = None
    query_model: str | None = None
```

and add below `compile_require_verbatim: bool = True`:

```python
    compile_max_retries: int = 1
```

and add these properties to the `Settings` class (after the field declarations, before the closing of the class):

```python
    @property
    def effective_compile_model(self) -> str:
        return self.compile_model or self.llm_model

    @property
    def effective_query_model(self) -> str:
        return self.query_model or self.llm_model
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run the full backend suite (guards against `.env`-coupled regressions)**

Run: `uv run pytest`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add kb/config.py tests/test_config.py
git commit -m "feat(config): per-task LLM models with Gemini 2.5 Flash default"
```

---

### Task 2: Shared structured-output helper module

**Files:**
- Create: `backend/kb/agents/structured.py`
- Modify: `backend/kb/agents/compile.py:69-92` (remove `OLLAMA_MODEL_PREFIXES` and the `_structured_output_kwargs` body; keep a thin wrapper)
- Create: `backend/tests/test_structured.py`

**Interfaces:**
- Produces: `kb.agents.structured.structured_output_kwargs(model: str, schema: dict, name: str) -> dict` and `kb.agents.structured.OLLAMA_MODEL_PREFIXES: tuple[str, ...]`. Task 3 imports `structured_output_kwargs`.
- Constraint: `kb.agents.compile._structured_output_kwargs(model, schema)` must keep its current 2-arg signature and behavior — `backend/tests/test_compile_agent.py:535-556` imports and calls it directly with the schema name `"compile_output"`.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_structured.py`:

```python
from kb.agents.structured import structured_output_kwargs


def test_ollama_models_use_native_format_param():
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = structured_output_kwargs("ollama_chat/qwen3:4b", schema, name="select_output")
    assert kwargs == {"extra_body": {"format": schema}}


def test_frontier_models_use_response_format_with_given_name():
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = structured_output_kwargs("gemini/gemini-2.5-flash", schema, name="select_output")
    assert kwargs == {
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "select_output",
                "strict": True,
                "schema": schema,
            },
        }
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_structured.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kb.agents.structured'`.

- [ ] **Step 3: Create the module and rewire compile.py**

Create `backend/kb/agents/structured.py`:

```python
OLLAMA_MODEL_PREFIXES = ("ollama/", "ollama_chat/")


def structured_output_kwargs(model: str, schema: dict, name: str) -> dict:
    """Provider-appropriate kwargs for JSON-Schema-constrained output.

    Ollama (via LiteLLM) doesn't reliably honor `response_format=json_schema`;
    instead, pass the schema through Ollama's native `format` parameter
    (extra_body), which reaches llama.cpp's grammar-constrained decoder.
    Frontier providers (OpenAI, Anthropic, Gemini) use the standard
    OpenAI-style `response_format`.
    """
    if model.startswith(OLLAMA_MODEL_PREFIXES):
        return {"extra_body": {"format": schema}}
    return {
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": name,
                "strict": True,
                "schema": schema,
            },
        }
    }
```

In `backend/kb/agents/compile.py`, add to the imports:

```python
from kb.agents.structured import structured_output_kwargs
```

then delete the `OLLAMA_MODEL_PREFIXES = ("ollama/", "ollama_chat/")` line and replace the whole `_structured_output_kwargs` function (lines 72–92) with:

```python
def _structured_output_kwargs(model: str, schema: dict) -> dict:
    return structured_output_kwargs(model, schema, name="compile_output")
```

- [ ] **Step 4: Run tests to verify they pass (new + existing compile tests)**

Run: `uv run pytest tests/test_structured.py tests/test_compile_agent.py -v`
Expected: all pass (the existing `test_structured_output_kwargs_*` tests in `test_compile_agent.py` exercise the wrapper).

- [ ] **Step 5: Commit**

```bash
git add kb/agents/structured.py kb/agents/compile.py tests/test_structured.py
git commit -m "refactor(agents): extract shared structured-output kwargs helper"
```

---

### Task 3: QueryAgent Phase 1 — structured slug selection

**Files:**
- Modify: `backend/kb/agents/query.py`
- Test: `backend/tests/test_query_agent.py` (append)

**Interfaces:**
- Consumes: `structured_output_kwargs(model, schema, name)` from Task 2; `SlugStr` from `kb.agents.compile_schema`.
- Produces: `kb.agents.query.SelectOutput` (Pydantic model, field `slugs: list[SlugStr]`, max 5) and `kb.agents.query._parse_selected_slugs(raw: str) -> list[str]`. No caller outside `query.py` uses these; `QueryAgent.query`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_query_agent.py` (the file already defines `_make_streaming_mock` at the top):

```python
@pytest.mark.asyncio
async def test_phase1_requests_structured_output(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nx\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = '{"slugs": ["deploy-process"]}'
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="gemini/gemini-2.5-flash")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase1_kwargs = mock_llm.call_args_list[0].kwargs
    assert phase1_kwargs["response_format"]["json_schema"]["name"] == "select_output"


@pytest.mark.asyncio
async def test_phase1_parses_json_slug_response(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nRun make deploy.\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = '{"slugs": ["deploy-process"]}'
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="gemini/gemini-2.5-flash")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "--- deploy-process ---" in phase2_system


@pytest.mark.asyncio
async def test_phase1_falls_back_to_comma_parse_on_free_text(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nRun make deploy.\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process, nonexistent-slug"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="gemini/gemini-2.5-flash")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "--- deploy-process ---" in phase2_system


@pytest.mark.asyncio
async def test_selected_slug_not_in_index_is_filtered(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nRun make deploy.\n",
    )
    # 'orphan' exists on disk but is NOT in the index — must not be selectable.
    fs.write_page(
        "orphan",
        "---\nslug: orphan\ntitle: Orphan\n---\nSecret orphan content.\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = '{"slugs": ["orphan", "deploy-process"]}'
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="gemini/gemini-2.5-flash")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "--- orphan ---" not in phase2_system
    assert "--- deploy-process ---" in phase2_system
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_query_agent.py -v -k "phase1_requests or parses_json or falls_back or not_in_index"`
Expected: `test_phase1_requests_structured_output` FAILS with `KeyError: 'response_format'`; `test_phase1_parses_json_slug_response` FAILS (the raw JSON string is comma-split into garbage slugs, so no page is fetched and only one LLM call happens → `IndexError` on `call_args_list[1]`); `test_selected_slug_not_in_index_is_filtered` FAILS on the `--- orphan ---` assertion.

- [ ] **Step 3: Implement structured selection**

In `backend/kb/agents/query.py`:

Add imports (top of file):

```python
from pydantic import BaseModel, Field, ValidationError

from kb.agents.compile_schema import SlugStr
from kb.agents.structured import structured_output_kwargs
```

Replace the `SELECT_PROMPT` constant with:

```python
SELECT_PROMPT = """You are a knowledge base search assistant.

Given the index below and the recent conversation, return the slugs of the wiki pages most relevant to the conversation (max 5).

INDEX:
{index}

RECENT CONVERSATION:
{history}

Respond with JSON only, e.g.: {{"slugs": ["deploy-process", "database-migrations"]}}"""
```

Add the output model and parse helper (after the prompt constants, before `_parse_wikilinks`):

```python
class SelectOutput(BaseModel):
    slugs: list[SlugStr] = Field(
        max_length=5,
        description="Slugs of the wiki pages most relevant to the conversation.",
    )


def _parse_selected_slugs(raw: str) -> list[str]:
    """Parse Phase 1 output: JSON schema first, comma-split fallback."""
    try:
        return list(SelectOutput.model_validate_json(raw).slugs)
    except ValidationError:
        return [s.strip() for s in raw.split(",") if s.strip()]
```

In `QueryAgent.query`, change the Phase 1 call to request structured output:

```python
        try:
            select_response = await litellm.acompletion(
                model=self._model,
                messages=[{
                    "role": "user",
                    "content": SELECT_PROMPT.format(index=index, history=_format_history(recent)),
                }],
                **structured_output_kwargs(
                    self._model, SelectOutput.model_json_schema(), name="select_output"
                ),
            )
        except Exception as exc:
            logger.error("llm.select_failed")
            raise LLMUpstreamError() from exc
```

and replace the two parsing lines

```python
        slugs_raw = select_response.choices[0].message.content.strip()
        slugs = [s.strip() for s in slugs_raw.split(",") if s.strip()]
```

with

```python
        slugs_raw = select_response.choices[0].message.content.strip()
        indexed_slugs = set(WIKILINK_RE.findall(index))
        slugs = [s for s in _parse_selected_slugs(slugs_raw) if s in indexed_slugs]
```

- [ ] **Step 4: Run the query agent tests**

Run: `uv run pytest tests/test_query_agent.py -v`
Expected: all pass, including all pre-existing tests (their mocks return free-text slugs, which the fallback parser handles, and their slugs are present in the index they write).

- [ ] **Step 5: Commit**

```bash
git add kb/agents/query.py tests/test_query_agent.py
git commit -m "feat(query): structured JSON slug selection with free-text fallback"
```

---

### Task 4: CompileAgent retry-with-feedback

**Files:**
- Modify: `backend/kb/agents/compile.py`
- Test: `backend/tests/test_compile_agent.py` (append)

**Interfaces:**
- Produces: `CompileAgent.__init__(..., max_retries: int = 1)` (Task 5 passes `settings.compile_max_retries` here); `kb.agents.compile.CompileValidationError` (internal exception, `str(exc)` is both the retry feedback and the final user-facing message).
- Constraint: after all attempts fail, `compile()` raises `LLMUpstreamError` with the **same message texts as today** ("LLM output did not match the expected schema.", "LLM output dropped a code block or table from the source.", "LLM output contained raw HTML block tags; markdown expected.", and the coverage message) — existing tests and the ingest API surface these.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_compile_agent.py`:

```python
RAW_WITH_CODE = "Intro text.\n\n```python\nprint('hi')\n```\n"
CODE_BLOCK = "```python\nprint('hi')\n```"

PAGE_WITHOUT_CODE = {
    "pages": [
        {
            "slug": "retry-doc",
            "title": "Retry Doc",
            "summary": "A doc used to test retries.",
            "related": [],
            "body": BODY_250,
        }
    ]
}

PAGE_WITH_CODE = {
    "pages": [
        {
            "slug": "retry-doc",
            "title": "Retry Doc",
            "summary": "A doc used to test retries.",
            "related": [],
            "body": BODY_250 + "\n\n" + CODE_BLOCK + "\n",
        }
    ]
}


@pytest.mark.asyncio
async def test_compile_retries_with_feedback_then_succeeds(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    mock = AsyncMock(
        side_effect=[_mock_response(PAGE_WITHOUT_CODE), _mock_response(PAGE_WITH_CODE)]
    )
    with patch("litellm.acompletion", new=mock):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("retry.md", RAW_WITH_CODE)

    assert mock.call_count == 2
    retry_messages = mock.call_args_list[1].kwargs["messages"]
    assert [m["role"] for m in retry_messages] == ["user", "assistant", "user"]
    assert retry_messages[1]["content"] == json.dumps(PAGE_WITHOUT_CODE)
    assert "failed validation" in retry_messages[2]["content"]
    assert "dropped a code block" in retry_messages[2]["content"]
    # The corrected output was written.
    assert _page_path(knowledge_dir, "retry-doc").exists()


@pytest.mark.asyncio
async def test_compile_raises_after_exhausting_retries(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    mock = AsyncMock(return_value=_mock_response(PAGE_WITHOUT_CODE))
    with patch("litellm.acompletion", new=mock):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("retry.md", RAW_WITH_CODE)

    assert mock.call_count == 2  # 1 attempt + 1 retry (default max_retries=1)
    assert not _page_path(knowledge_dir, "retry-doc").exists()


@pytest.mark.asyncio
async def test_compile_max_retries_zero_disables_retry(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    mock = AsyncMock(return_value=_mock_response(PAGE_WITHOUT_CODE))
    with patch("litellm.acompletion", new=mock):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0, max_retries=0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("retry.md", RAW_WITH_CODE)

    assert mock.call_count == 1


@pytest.mark.asyncio
async def test_compile_transport_errors_are_not_retried(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    mock = AsyncMock(side_effect=RuntimeError("connection reset"))
    with patch("litellm.acompletion", new=mock):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("retry.md", RAW_WITH_CODE)

    assert mock.call_count == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_compile_agent.py -v -k "retries or retry"`
Expected: `test_compile_retries_with_feedback_then_succeeds` FAILS with `LLMUpstreamError` (no retry loop yet — the first bad response raises immediately); `test_compile_raises_after_exhausting_retries` FAILS on `assert mock.call_count == 2` (got 1); `test_compile_max_retries_zero_disables_retry` FAILS with `TypeError: CompileAgent.__init__() got an unexpected keyword argument 'max_retries'`; the transport test may already pass.

- [ ] **Step 3: Implement the retry loop**

In `backend/kb/agents/compile.py`:

Add after the `PROPOSED_BLOCK_PREFIX` constant:

```python
RETRY_FEEDBACK_TEMPLATE = (
    "Your previous output failed validation: {feedback} "
    "Return the complete corrected output, following all rules in the "
    "original instructions."
)


class CompileValidationError(Exception):
    """LLM output failed a post-generation validation gate.

    str(exc) doubles as the user-facing error message and as the corrective
    feedback sent back to the model on retry.
    """
```

Change the constructor to accept `max_retries`:

```python
    def __init__(
        self,
        fs: WikiFS,
        model: str,
        min_coverage: float = 0.7,
        require_verbatim: bool = True,
        max_retries: int = 1,
    ) -> None:
        self._fs = fs
        self._model = model
        self._min_coverage = min_coverage
        self._require_verbatim = require_verbatim
        self._max_retries = max_retries
```

Replace the body of `compile()` (keep the index/prompt preamble) with the attempt loop, and split request/validation into helpers:

```python
    async def compile(self, filename: str, raw_content: str) -> None:
        existing_summaries = _parse_index(self._fs.read_index())
        existing_index = (
            "\n".join(
                f"- {slug} — {summary}"
                for slug, summary in sorted(existing_summaries.items())
            )
            or "(none yet)"
        )

        prompt = COMPILE_PROMPT.format(
            existing_index=existing_index,
            filename=filename,
            raw_content=raw_content,
            min_coverage=self._min_coverage,
        )

        messages: list[dict] = [{"role": "user", "content": prompt}]
        attempts = 1 + self._max_retries
        for attempt in range(1, attempts + 1):
            raw_output = await self._request(messages)
            try:
                output = self._validate(raw_output, raw_content)
                break
            except CompileValidationError as exc:
                if attempt >= attempts:
                    raise LLMUpstreamError(str(exc)) from exc
                logger.warning(
                    "compile.retry",
                    extra={"attempt": attempt, "reason": str(exc)},
                )
                messages = [
                    *messages,
                    {"role": "assistant", "content": raw_output},
                    {
                        "role": "user",
                        "content": RETRY_FEEDBACK_TEMPLATE.format(feedback=str(exc)),
                    },
                ]

        self._write(output, filename, existing_summaries)

    async def _request(self, messages: list[dict]) -> str:
        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=messages,
                **_structured_output_kwargs(
                    self._model, CompileOutput.model_json_schema()
                ),
            )
        except Exception as exc:
            logger.error("llm.compile_failed")
            raise LLMUpstreamError(
                "LLM request failed (network or upstream)."
            ) from exc
        return response.choices[0].message.content

    def _validate(self, raw_output: str, raw_content: str) -> CompileOutput:
        try:
            output = CompileOutput.model_validate_json(raw_output)
        except Exception as exc:
            logger.error("compile.schema_validation_failed")
            raise CompileValidationError(
                "LLM output did not match the expected schema."
            ) from exc

        if self._require_verbatim:
            self._assert_verbatim(output, raw_content)
        self._assert_no_block_html(output)
        self._assert_coverage(output, raw_content)
        return output
```

Change the three `_assert_*` methods to raise `CompileValidationError` instead of `LLMUpstreamError`, keeping the exact message texts:

```python
    def _assert_no_block_html(self, output: CompileOutput) -> None:
        for page in output.pages:
            if BLOCK_HTML_RE.search(page.body):
                logger.error(
                    "compile.block_html_present", extra={"slug": page.slug}
                )
                raise CompileValidationError(
                    "LLM output contained raw HTML block tags; markdown expected."
                )

    def _assert_verbatim(self, output: CompileOutput, raw_content: str) -> None:
        required = _extract_required_blocks(raw_content)
        if not required:
            return
        combined = "\n\n".join(p.body for p in output.pages)
        missing = [block for block in required if block not in combined]
        if missing:
            logger.error(
                "compile.verbatim_missing", extra={"missing_count": len(missing)}
            )
            raise CompileValidationError(
                "LLM output dropped a code block or table from the source."
            )

    def _assert_coverage(self, output: CompileOutput, raw_content: str) -> None:
        content_chars = sum(len(p.body) + len(p.summary) for p in output.pages)
        raw_chars = len(raw_content)
        if raw_chars == 0:
            return
        ratio = content_chars / raw_chars
        if ratio < self._min_coverage:
            logger.error(
                "compile.coverage_too_low",
                extra={"ratio": ratio, "threshold": self._min_coverage},
            )
            raise CompileValidationError(
                f"LLM output covered {ratio:.1%} of source "
                f"(< {self._min_coverage:.0%} required); model likely over-summarized."
            )
```

Note: `LLMUpstreamError` remains imported and raised — by `_request` (transport) and by the loop's terminal conversion. The frontmatter error path in `_write_one` (`Existing wiki page ... has missing or invalid frontmatter`) stays `LLMUpstreamError` — it happens after validation succeeds, in `_write`, and retrying can't fix a corrupted page on disk.

- [ ] **Step 4: Run the compile agent tests**

Run: `uv run pytest tests/test_compile_agent.py -v`
Expected: all pass. Pre-existing failure-path tests (bad schema, missing verbatim, coverage, HTML) still raise `LLMUpstreamError` — they use `return_value` mocks, so the retry consumes a second identical response and the final attempt converts to `LLMUpstreamError` with the same message.

- [ ] **Step 5: Commit**

```bash
git add kb/agents/compile.py tests/test_compile_agent.py
git commit -m "feat(compile): retry once with validation feedback before failing ingest"
```

---

### Task 5: Wire call sites to per-task models

**Files:**
- Modify: `backend/kb/api/ingest.py:30-35`
- Modify: `backend/kb/api/chat.py:48`
- Test: `backend/tests/test_api_ingest.py` (append), `backend/tests/test_api_chat.py` (append)

**Interfaces:**
- Consumes: `settings.effective_compile_model`, `settings.effective_query_model`, `settings.compile_max_retries` (Task 1); `CompileAgent(max_retries=...)` (Task 4).

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_api_ingest.py` (add any missing imports at the top of the file: `from kb.api import ingest as ingest_module`, `from kb.jobs.store import InMemoryJobStore`, `from kb.wiki.fs import WikiFS`, `import pytest`):

```python
@pytest.mark.asyncio
async def test_run_compile_uses_effective_compile_model(
    knowledge_dir, schema_dir, monkeypatch
):
    monkeypatch.setattr(ingest_module.settings, "llm_model", "gemini/gemini-2.5-flash")
    monkeypatch.setattr(
        ingest_module.settings, "compile_model", "anthropic/claude-haiku-4-5"
    )
    monkeypatch.setattr(ingest_module.settings, "compile_max_retries", 3)

    captured = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def compile(self, filename, raw_content):
            pass

    monkeypatch.setattr(ingest_module, "CompileAgent", FakeAgent)

    fs = WikiFS(knowledge_dir, schema_dir)
    store = InMemoryJobStore()
    job = store.create_job("doc.md")
    await ingest_module._run_compile(job.job_id, "doc.md", "raw content", fs, store)

    assert captured["model"] == "anthropic/claude-haiku-4-5"
    assert captured["max_retries"] == 3
```

Append to `backend/tests/test_api_chat.py` (add missing imports at the top: `from kb.api import chat as chat_module`, `from kb.wiki.fs import WikiFS`, `import pytest`):

```python
@pytest.mark.asyncio
async def test_chat_uses_effective_query_model(knowledge_dir, schema_dir, monkeypatch):
    monkeypatch.setattr(chat_module.settings, "llm_model", "gemini/gemini-2.5-flash")
    monkeypatch.setattr(
        chat_module.settings, "query_model", "gemini/gemini-2.5-flash-lite"
    )

    captured = {}

    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def query(self, messages):
            yield "ok"

    monkeypatch.setattr(chat_module, "QueryAgent", FakeAgent)

    fs = WikiFS(knowledge_dir, schema_dir)
    request = chat_module.ValidatedChatRequest(
        messages=[{"role": "user", "content": "hi"}]
    )
    await chat_module.chat(request, fs=fs)

    assert captured["model"] == "gemini/gemini-2.5-flash-lite"
```

Note: `monkeypatch.setattr` on the shared `settings` singleton is automatically undone after each test, so other tests are unaffected.

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_api_ingest.py::test_run_compile_uses_effective_compile_model tests/test_api_chat.py::test_chat_uses_effective_query_model -v`
Expected: FAIL — ingest asserts `'gemini/gemini-2.5-flash' == 'anthropic/claude-haiku-4-5'` (it still reads `settings.llm_model`) and `KeyError: 'max_retries'`; chat asserts the same model mismatch.

- [ ] **Step 3: Update the call sites**

In `backend/kb/api/ingest.py`, replace the `CompileAgent(...)` construction:

```python
        agent = CompileAgent(
            fs=fs,
            model=settings.effective_compile_model,
            min_coverage=settings.compile_min_coverage,
            require_verbatim=settings.compile_require_verbatim,
            max_retries=settings.compile_max_retries,
        )
```

In `backend/kb/api/chat.py`, replace line 48:

```python
    agent = QueryAgent(fs=fs, model=settings.effective_query_model)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_api_ingest.py tests/test_api_chat.py -v`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add kb/api/ingest.py kb/api/chat.py tests/test_api_ingest.py tests/test_api_chat.py
git commit -m "feat(api): wire compile/chat to per-task effective models"
```

---

### Task 6: Documentation, full-suite verification

**Files:**
- Modify: `backend/.env.example`
- Modify: `CLAUDE.md` (one sentence in "Development Commands")

**Interfaces:**
- Consumes: setting names from Task 1 (`LLM_MODEL`, `COMPILE_MODEL`, `QUERY_MODEL`, `COMPILE_MAX_RETRIES` env vars).

- [ ] **Step 1: Rewrite the model section of `.env.example`**

Replace lines 1–2 of `backend/.env.example` (`LLM_MODEL=claude-sonnet-4-6` and `KNOWLEDGE_DIR=...`) with:

```bash
# --- LLM models (any LiteLLM-compatible model id) ---
# Default: Google Gemini 2.5 Flash. Create a key at https://aistudio.google.com/
# (the free tier usually covers a small team) and set GEMINI_API_KEY.
LLM_MODEL=gemini/gemini-2.5-flash
GEMINI_API_KEY=change-me

# Optional per-task overrides (each falls back to LLM_MODEL when unset):
#   COMPILE_MODEL — ingest-time compiler (hard task: use the strongest cheap model)
#   QUERY_MODEL   — chat pipeline (easier task: can be cheaper/faster)
#COMPILE_MODEL=gemini/gemini-2.5-flash
#QUERY_MODEL=gemini/gemini-2.5-flash-lite

# Anthropic alternative (set ANTHROPIC_API_KEY):
#LLM_MODEL=anthropic/claude-haiku-4-5

# Local via Ollama (dev/fallback only): runs on CPU/iGPU — NPUs are NOT used —
# so expect slow streaming. Small models often fail the verbatim compile gate;
# pair with COMPILE_REQUIRE_VERBATIM=false below.
#LLM_MODEL=ollama_chat/qwen3:4b

# Corrective retries when compile output fails validation (schema / verbatim /
# coverage). Total LLM attempts per ingest = 1 + COMPILE_MAX_RETRIES.
COMPILE_MAX_RETRIES=1

KNOWLEDGE_DIR=/path/to/your/obsidian-vault/team-kb
```

Keep everything from `# Required. Generate with:` (the `JWT_SECRET` block) to the end of the file unchanged.

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, in the sentence "Configuration comes from `backend/.env` — copy `backend/.env.example` and set `LLM_MODEL` (any LiteLLM-compatible model id) and optionally `KNOWLEDGE_DIR`.", replace with:

"Configuration comes from `backend/.env` — copy `backend/.env.example`, set `LLM_MODEL` (any LiteLLM-compatible model id; default `gemini/gemini-2.5-flash`, requires `GEMINI_API_KEY`) plus `KNOWLEDGE_DIR`. `COMPILE_MODEL` / `QUERY_MODEL` optionally override the model per task."

- [ ] **Step 3: Run the full backend suite and lint**

Run (from `backend/`):

```bash
uv run pytest
uv run ruff check .
```

Expected: all tests pass, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add backend/.env.example CLAUDE.md
git commit -m "docs: document per-task model config with Gemini 2.5 Flash default"
```

---

## Self-Review Notes

- **Spec coverage:** §1 config → Task 1 + 5 + 6; §2 structured select → Task 2 + 3; §3 retry loop → Task 4; §4 tests → embedded per task, full suite in Task 6. Out-of-scope items untouched.
- **Type consistency:** `structured_output_kwargs(model, schema, name)` defined in Task 2, consumed in Task 3; `max_retries` kwarg defined in Task 4, consumed in Task 5; `effective_*_model` defined in Task 1, consumed in Task 5.
- **Existing-test compatibility:** `_structured_output_kwargs` keeps its 2-arg signature (Task 2); error message texts unchanged (Task 4); fallback comma-parsing keeps all pre-existing query tests green (Task 3).
