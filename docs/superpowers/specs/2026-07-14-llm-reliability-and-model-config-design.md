# LLM Reliability & Model Configuration — Design

**Date:** 2026-07-14
**Status:** Approved (design), pending implementation plan
**Scope:** Backend only (`backend/kb/`). Frontend and `LintAgent` untouched.

## Problem

The project stalled on two blockers:

1. **Model choice.** A single `LLM_MODEL` drives both the ingest-time compiler (a
   hard task: whole document → multi-page structured JSON with verbatim code
   blocks and a ≥70% coverage gate) and the query pipeline (an easy task: slug
   selection + grounded answering). No affordable model is good at both, and
   local Ollama models on the target hardware (integrated GPU; NPU unreachable
   from Ollama) failed the compile gates and produced unparseable Phase 1
   output.
2. **Prompt fragility.** Two fracture points made every prompt/model
   combination feel broken:
   - `QueryAgent` Phase 1 asks for free-text comma-separated slugs; smaller
     models add prose and break the parser.
   - `CompileAgent` has no retry: one validation failure (schema, verbatim,
     block-HTML, coverage) kills the entire ingest job.

**Decision context:** local was about cost, not privacy. Team scale is 2–5
people (~5–20 ingests/week, tens of queries/day). At that scale a cheap cloud
model costs a few dollars a month — likely $0 on Gemini's free tier — and is
both faster and more reliable than a 3–4B local model on this hardware.

## Design

### 1. Per-task model configuration

`kb/config.py` `Settings` changes:

```python
llm_model: str = "gemini/gemini-2.5-flash"   # new default (was claude-sonnet-4-6)
compile_model: str | None = None              # falls back to llm_model
query_model: str | None = None                # falls back to llm_model
compile_max_retries: int = 1                  # see §3
```

Resolution via two properties on `Settings`:
`effective_compile_model` (= `compile_model or llm_model`) and
`effective_query_model` (= `query_model or llm_model`).

Call-site changes:

- `kb/api/ingest.py` — `CompileAgent(model=settings.effective_compile_model, ...)`
- `kb/api/chat.py` — `QueryAgent(model=settings.effective_query_model, ...)`

`.env.example` gains a short decision guide:

- **Default / recommended:** `gemini/gemini-2.5-flash` for both tasks. Requires
  `GEMINI_API_KEY` (Google AI Studio; free tier likely covers a small team).
- **Optional split:** `QUERY_MODEL=gemini/gemini-2.5-flash-lite` for
  cheaper/faster chat.
- **Local (dev/fallback):** `ollama_chat/qwen3:4b` with notes: Ollama runs on
  CPU/iGPU only (the NPU is not used), expect slow streaming, and set
  `COMPILE_REQUIRE_VERBATIM=false` if compile keeps failing the verbatim gate.
- **Anthropic alternative:** `anthropic/claude-haiku-4-5` (needs
  `ANTHROPIC_API_KEY`).

Backward compatibility: an existing `.env` with only `LLM_MODEL` set behaves
exactly as before (single model everywhere).

### 2. QueryAgent Phase 1 — structured slug selection

In `kb/agents/query.py`:

- New Pydantic model:

  ```python
  class SelectOutput(BaseModel):
      slugs: list[SlugStr] = Field(max_length=5)
  ```

  (`SlugStr` reused from `compile_schema.py`.)

- `_structured_output_kwargs` moves from `compile.py` to a new shared module
  `kb/agents/structured.py` (verbatim move; it already handles the
  Ollama-native-`format` vs frontier-`response_format` split).
  `compile.py` imports it from there.

- Phase 1 call passes the structured-output kwargs for `SelectOutput` and the
  prompt is updated to request JSON (`{"slugs": ["a", "b"]}`).

- Parsing: try `SelectOutput.model_validate_json` first; **on failure, fall
  back to the current comma-split** so free-text-replying models don't regress.

- Selected slugs are filtered against the parsed index before page reads;
  hallucinated slugs are dropped early (today they surface as
  `FileNotFoundError` skips).

No change to Phase 2 (streaming answer) or the citations contract.

### 3. CompileAgent — retry with validation feedback

In `kb/agents/compile.py`, `compile()` becomes an attempt loop with
`1 + settings.compile_max_retries` total attempts (default 2):

- The post-LLM validations (Pydantic schema, verbatim blocks, block-HTML,
  coverage) raise an internal `CompileValidationError(feedback: str)` where
  `feedback` names the specific failure (e.g. "output dropped 2 fenced code
  blocks that must appear verbatim", "coverage was 54% (< 70% required)").
- On a validation failure with attempts remaining, the next call extends the
  conversation:

  ```
  user:      <original compile prompt>
  assistant: <previous raw model output>
  user:      Your previous output failed validation: <feedback>.
             Return the complete corrected output.
  ```

  Each retry logs `compile.retry` with the failure reason.
- Transport/upstream errors are **not** retried here (LiteLLM/SDK retry those)
  and still raise `LLMUpstreamError` immediately.
- After the final failed attempt, the same `LLMUpstreamError` messages surface
  as today — the API contract and existing tests are unchanged.

### 4. Testing (TDD, per project constitution)

Tests are written first and confirmed failing before implementation:

1. **Config resolution** — `effective_*_model` falls back to `llm_model`;
   explicit `compile_model` / `query_model` win.
2. **Query select** (mocked `litellm.acompletion`):
   - JSON response → parsed slugs;
   - free-text comma response → fallback parse still works;
   - slug not in index → filtered out before page read.
3. **Compile retry** (mocked `litellm.acompletion`):
   - attempt 1 fails verbatim validation, attempt 2 passes → ingest succeeds
     and the second call's messages contain the assistant output + feedback;
   - all attempts fail → `LLMUpstreamError` raised;
   - transport error → no retry, immediate `LLMUpstreamError`.
4. Full backend suite green: `.venv/bin/pytest` (Windows: `uv run pytest`).

## Out of scope (future candidates)

- **Placeholder mechanism for verbatim blocks** — extract code blocks/tables
  before prompting, have the model emit `{{BLOCK_n}}`, reinsert
  programmatically. Eliminates the verbatim failure mode and cuts output
  tokens; deferred.
- Chunked per-concept compilation for very large documents.
- Prompt caching / cost telemetry.
- Any frontend change; `LintAgent`.

## Alternatives considered

- **Fully local (Ollama) pipeline reshape** — rejected: on the target hardware
  (iGPU/CPU only) a 3–4B model is slower than cloud API latency, needs the most
  engineering, and has the lowest quality ceiling. Local remains a documented
  dev/fallback path through the same config.
- **Minimal fix only (Phase 1 parsing + model swap)** — rejected: leaves
  compile one bad response away from a dead ingest job and keeps the
  single-model constraint that caused the original deadlock.
- **Anthropic Haiku 4.5 default** — viable (~$15–20/month) but the team
  preferred a non-Anthropic default; Gemini 2.5 Flash's free tier likely makes
  the cost $0 at this scale. Haiku stays documented as an alternative.
