# CompileAgent: structured output redesign

**Status:** implemented 2026-04-19 — see commit on `feature/chat-foundation`
**Date:** 2026-04-19
**Touches:** `backend/kb/agents/compile.py`, `backend/kb/agents/compile_schema.py` (new), `backend/tests/test_compile_agent.py`, `backend/tests/test_compile_schema.py` (new), `backend/kb/config.py`, `backend/kb/api/ingest.py`, `backend/knowledge/schema/SCHEMA.md`

## Why this exists

The current `CompileAgent` asks the LLM to produce a custom `=== PAGE: ===` / `=== INDEX ===` / `=== LOG_ENTRY ===` delimiter format and parses the output by string-splitting on `===`. Three classes of bugs have shipped to disk because of this design:

1. **Slug shape drift** — LLM emits `=== PAGE: foo.md ===`; `WikiFS.write_page` appends `.md` again → `foo.md.md` on disk.
2. **Block-type confusion** — LLM emits `=== PAGE: index ===` instead of `=== INDEX ===`; the index ends up as a page and `wiki/index.md` stays stale. Same pattern with `log-entry`.
3. **Template non-conformance** — LLM emits pages with no `# Title`, no `**Slug:**`, no `## Summary` / `## Details` / `## References`. Schema is documented in `SCHEMA.md` but enforced only by prompt wording.

Each bug was patched by adding a layer of defense: tighter prompt wording, slug normalization in the parser, magic-name routing for `index` / `log-entry` slugs, and a post-parse invariant check that fails the job if PAGE or INDEX blocks are missing. Each layer reduces a failure mode, but none of them remove the root cause: **we are using natural-language formatting to enforce structure that should be enforced by types.**

The prompt is approaching 80 lines of imperative rules, the parser has special cases for known drift patterns, and we still have no defense against template non-conformance or content-coverage regressions. The next drift mode will trigger another patch on the same fragile foundation.

## What "comprehensive" means here

Switch to **structured LLM output** with a Pydantic schema. Replace the custom delimiter format and the bespoke parser with a JSON contract that:

- Makes the three bug classes above **representationally impossible** rather than defensively patched.
- Enforces the page template at the type layer (Pydantic), not via prompt wording.
- Eliminates the `output.split("===")` parser entirely.
- Shrinks the prompt to describing intent (what to extract from the raw doc), not format (how to lay it out).

## Proposed design

### 1. Output schema (Pydantic)

```python
# backend/kb/agents/compile_schema.py
from datetime import date
from pydantic import BaseModel, Field

class WikiPageOutput(BaseModel):
    slug: str = Field(
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Lowercase, hyphen-separated. No .md, no path separators.",
    )
    title: str = Field(min_length=1)
    related: list[str] = Field(default_factory=list)
    last_updated: date
    summary: str = Field(min_length=1)
    details: str = Field(min_length=1)
    references: list[str] = Field(min_length=1)

class CompileOutput(BaseModel):
    pages: list[WikiPageOutput] = Field(min_length=1)
    index_md: str = Field(min_length=1)
    log_entry: str = Field(min_length=1)
```

This schema, by itself, eliminates:
- Bug 1 (`.md.md`) — `slug` regex rejects `.md` suffix.
- Bug 2 (index-as-page) — `pages` and `index_md` are distinct fields; the LLM can't put the index in `pages`.
- Bug 3 (template non-conformance) — every page has all five fields by construction; `WikiFS` renders them into the Markdown template.

### 2. Render template in code, not in the LLM

Move the page Markdown template into a small render function:

```python
def render_page_md(page: WikiPageOutput, source_filename: str) -> str:
    related = ", ".join(f"[[{s}]]" for s in page.related) or "(none)"
    return (
        f"# {page.title}\n\n"
        f"**Slug:** {page.slug}\n"
        f"**Related:** {related}\n"
        f"**Last updated:** {page.last_updated.isoformat()}\n\n"
        f"## Summary\n\n{page.summary}\n\n"
        f"## Details\n\n{page.details}\n\n"
        f"## References\n\n"
        + "\n".join(f"- {ref}" for ref in page.references)
        + "\n"
    )
```

The LLM no longer composes the Markdown layout — it only supplies the field values. Layout consistency becomes a code property, not an LLM property.

### 3. Use LiteLLM `response_format`

```python
response = await litellm.acompletion(
    model=self._model,
    messages=[{"role": "user", "content": prompt}],
    response_format=CompileOutput,  # litellm supports Pydantic models directly
)
parsed = CompileOutput.model_validate_json(response.choices[0].message.content)
```

LiteLLM translates this to provider-native structured output (Anthropic tool use, OpenAI JSON Schema mode, etc.). On schema violation the model is forced to retry — we don't have to write that retry loop.

Provider support note: verify the configured `LLM_MODEL` supports JSON Schema / tool use response formatting. Anthropic Claude 3.5+, OpenAI gpt-4o+, and Gemini 1.5+ all do. If a deployment uses an older or weaker provider, fall back to the current parser behind a feature flag (or document that structured output requires a minimum model tier).

### 4. Shrink the prompt

The prompt collapses from "format rules + worked example + invariants" to:
- What the raw document is.
- The current index and existing pages (for slug consistency).
- Instruction: "Extract every distinct concept as a separate `WikiPageOutput`. Do not summarize. The `details` field of each page should preserve all source content for that concept."

Estimate: ~25 lines, down from ~80. The schema documentation lives in code, not in prose.

### 5. Coverage validator (closes the round-2 bug class)

Even with structured output, the LLM can still summarize. Add a coverage check:

```python
def assert_coverage(output: CompileOutput, raw_content: str, min_ratio: float = 0.4) -> None:
    output_chars = sum(len(p.details) + len(p.summary) for p in output.pages)
    if output_chars < min_ratio * len(raw_content):
        raise LLMUpstreamError(
            f"Compile output covers {output_chars}/{len(raw_content)} chars "
            f"(< {min_ratio:.0%}); likely over-summarized."
        )
```

The 0.4 threshold is a starting heuristic — tune against real documents. This is the only piece the current MVP fix doesn't address at all.

## Migration plan

Each step is independently shippable and verifiable.

1. **Add `compile_schema.py` with `WikiPageOutput` / `CompileOutput`.** Tests: round-trip Pydantic validation; reject `.md` slug; reject empty pages list.
2. **Add `render_page_md` helper.** Tests: golden-file output for a fixture page.
3. **Add a new `CompileAgent.compile_structured()` method** alongside the existing `compile()`. Use `response_format=CompileOutput`. Don't delete the old method yet.
4. **Add coverage validator.** Test that high-coverage output passes; over-summarized output raises.
5. **Switch `_run_compile` in `api/ingest.py` to call `compile_structured`.** Re-ingest the existing raw docs; verify pages conform to the template, index updates, log appends. Diff against the round-3 output to confirm parity or improvement.
6. **Delete `_parse_and_write`, `COMPILE_PROMPT`, the magic-name routing, and the regression tests for those defenses.** They become dead code.
7. **Update `SCHEMA.md`** to point at the Pydantic schema as the source of truth, with the rendered Markdown shape shown as derived output.

Roll-back: if step 5 produces worse pages than the current parser-defensive version, revert the `_run_compile` switch (one line). Steps 1–4 leave no user-visible change.

## What this fix removes

- ~30 lines of `_parse_and_write` (delimiter splitter + magic-name routing + invariant check).
- ~50 lines of imperative format rules in `COMPILE_PROMPT`.
- The three regression tests pinning the defensive behavior (`test_compile_strips_md_suffix_from_slug`, `test_compile_routes_index_page_to_write_index`, `test_compile_raises_when_index_block_missing`) — replaced by Pydantic validation tests, which are smaller and more general.
- The `list_pages()[-N:]` "alphabetical not recent" footgun in `compile.py:104` (fix while you're in there — it's two lines).

## What this fix does NOT address

- **One-shot LLM call.** Still no chunking / map-reduce for documents that exceed the model's context. Add only if real documents trigger truncation.
- **Retry policy on coverage failure.** Currently a coverage failure marks the job FAILED. A more robust design would retry once with a stronger prompt before failing. Defer until coverage failures are observed in practice.
- **Existing-pages drift loop.** The compile prompt still injects existing pages as context. Once pages are template-conforming (post-migration), the drift loop is benign. If it isn't, label the existing pages explicitly and consider sending only their slugs + summaries instead of full content.

## Why this is deferred

The current MVP works for the user's actual ingest volume. The defensive fix (round 3) is enough to:
- Prevent silent corruption (FAILED job instead of stale index).
- Survive the three known drift modes.
- Pass tests in CI.

The structured-output redesign is the right move when **any one** of these becomes true:
- A fourth distinct LLM drift mode appears (signal that prompt+parser patches are no longer sufficient).
- Template non-conformance (round-2 bug) regresses with a model swap.
- Document corpus grows enough that silent over-summarization becomes a real cost (currently easy to spot manually).
- The prompt grows past ~120 lines (sign that we're fighting the format with prose).

Until then, the layered fix is the cheaper investment.

## References

- Current implementation: `backend/kb/agents/compile.py`
- Storage layer: `backend/kb/wiki/fs.py`
- Template spec (current): `backend/knowledge/schema/SCHEMA.md`
- Tests: `backend/tests/test_compile_agent.py`
- LiteLLM structured output: https://docs.litellm.ai/docs/completion/json_mode
