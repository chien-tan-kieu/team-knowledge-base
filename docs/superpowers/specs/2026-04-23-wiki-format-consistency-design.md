# Wiki Format Consistency — Design

**Status:** design approved, pending implementation plan
**Date:** 2026-04-23
**Author:** chien.tankieu (with Claude)

## Problem

Compiled wiki pages are inconsistently formatted. Two concrete failures on disk today:

1. `backend/knowledge/wiki/pages/claude-modes-comparison.md` — body is raw HTML (`<p>`, `<strong>`, `<table>`, `<td>`) instead of Markdown, with some malformed tags (`<td Native</td>`, literal `\n` inside a cell). `react-markdown` strips unknown HTML by default, so the page renders as garbled plain text.
2. `backend/knowledge/wiki/pages/comparison-table.md` — body is valid GFM markdown with a pipe table, but the table does not render in the UI.

Analysis surfaced three additional issues:

3. `WikiPageOutput.related` accepts arbitrary strings; `comparison-table.md` contains `related: [/docs/anthropic/…/modes-chat, …]` — external URL-like paths that aren't valid slugs.
4. Bodies sometimes repeat the page title as a heading (e.g. `comparison-table.md` renders `# Comparison Table of Claude Modes` from the template followed by `## Comparison Table of Claude Modes` from the LLM body).
5. No ingest-time guardrail rejects raw HTML block tags, so failure mode (1) silently persists.

## Goals

Tighten the ingestion pipeline so compiled pages are consistently well-formed GFM markdown that renders correctly in the frontend.

**In scope:**

1. Compile prompt explicitly requires GFM markdown, forbids raw HTML block tags, forbids repeating the page title.
2. Ingest-time guardrail rejects bodies containing block-level HTML tags. Inline tags allowed.
3. `WikiPageOutput.related` items validated against the slug regex via JSON-Schema `pattern`. Bad output → `LLMUpstreamError`.
4. `render_page_md` strips a leading `# Title` or `## Title` line from the body when it matches the page title.
5. `WikiPageViewer` passes `remarkPlugins={[remarkGfm]}` to `ReactMarkdown`. New runtime dependency: `remark-gfm`.

**Out of scope:**

- Regenerating the two broken pages. That's a separate manual re-ingest step after merge.
- Any `rehype-raw` / HTML-rendering support in the frontend. Consequence: `claude-modes-comparison.md` will continue to render poorly in the UI until regenerated.
- Changes to the ChatPage / streaming markdown render path.
- Changes to `COMPILE_MIN_COVERAGE` / verbatim logic.
- Any expansion of `LintAgent` (noted as a follow-up below).

## Architecture

The fixes touch three layers, each with a single narrow responsibility.

### Layer A — Prompt (`backend/kb/agents/compile.py`)

Extend `COMPILE_PROMPT` with an explicit "Output format rules" section. No change to the existing split/verbatim/coverage instructions.

### Layer B — Validation (`backend/kb/agents/compile_schema.py` + `compile.py`)

Two peers to the existing `_assert_verbatim` / `_assert_coverage` guardrails:

1. `WikiPageOutput.related` gets a per-item `pattern` constraint via `Annotated[str, StringConstraints(pattern=...)]`. Surfaces in `model_json_schema()` and constrains LiteLLM's structured output. Violations raise the same `LLMUpstreamError("LLM output did not match the expected schema.")` as other schema failures.
2. New `CompileAgent._assert_no_block_html(output)` scans each body for a fixed list of block-level HTML tag opens and raises `LLMUpstreamError` on any match. Called after `_assert_verbatim`, before `_write`. Runs unconditionally (not behind `_require_verbatim`).

### Layer C — Rendering

1. `render_page_md` strips a leading `# <title>` or `## <title>` line from `page.body` before composing the final page. Exact title-equality match, newline-aware.
2. `WikiPageViewer.tsx` imports `remark-gfm` and passes it as `remarkPlugins`. No change to `withLines` or the `components` map.

### What stays untouched

`WikiFS`, the SSE chat path, the ingest API, the job store, `LintAgent`, and all existing tests.

### Failure mode

If the model outputs invalid content, behavior matches today's guardrail failures: the ingest job fails with `LLMUpstreamError`, no partial writes, the caller can retry.

### Why not move validation to `LintAgent`?

CompileAgent is a **gate** — it runs inside the ingest request, before anything is persisted. Its checks (verbatim, coverage, now block-HTML, now `related` slugs) refuse bad LLM output so nothing broken reaches disk. LintAgent is a **report** — a post-hoc disk scanner triggered by `POST /api/lint` that only finds orphans today.

Moving format checks to lint would be a regression: bad output would reach disk; the natural retry-on-failure loop would be lost; two existing checks (`_assert_verbatim`, `_assert_coverage`) need the raw document in memory, which lint doesn't have. The principle: **gate what you can verify at generation time; report what requires cross-page or human judgment.** Each new check fits naturally into the gate side.

## Per-issue change details

### Issue 1 — Prompt tightening (`backend/kb/agents/compile.py`, `COMPILE_PROMPT`)

Append a new block after the existing numbered validation rules, before "Rephrase prose…":

```
Output format rules (body field of each page):
- Use GitHub-Flavored Markdown only. Do not emit raw HTML block tags
  (<table>, <p>, <div>, <td>, <tr>, <thead>, <tbody>, <th>, <ul>, <ol>, <li>).
  Small inline HTML such as <br/>, <sub>, <sup>, <details> is allowed when useful.
- Tables must use pipe syntax (| col | col |) with a --- separator row, not HTML.
- Do not repeat the page title as a heading inside the body. The renderer already
  emits "# <title>" above the body; start the body with the first real subsection
  or paragraph.
```

No change to the `min_coverage:.0%` interpolation or to `compile_schema.py` docstrings (the model reads the prompt, not the schema docstring).

### Issue 2 — `remark-gfm` in frontend (`frontend/`)

1. `pnpm add remark-gfm` in the `frontend` workspace (runtime dep).
2. `WikiPageViewer.tsx`:

   ```tsx
   import remarkGfm from 'remark-gfm'
   …
   <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
   ```

3. No change to `withLines` or the `components` map. GFM tables continue to go through the existing `table` component with line tracking.

### Issue 3 — `related` slug validation (`backend/kb/agents/compile_schema.py`)

```python
from typing import Annotated
from pydantic import StringConstraints

SlugStr = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]

class WikiPageOutput(BaseModel):
    …
    related: list[SlugStr] = Field(
        description="Slugs of related pages. Empty list if none."
    )
```

The per-item pattern reaches LiteLLM's `response_format` via `model_json_schema()` and also validates on `model_validate_json`. Violations raise `LLMUpstreamError` with the existing schema-validation message.

### Issue 4 — Strip duplicate title (`backend/kb/agents/compile_schema.py`, `render_page_md`)

New helper, used only by `render_page_md`:

```python
def _strip_leading_title(body: str, title: str) -> str:
    for prefix in ("# ", "## "):
        candidate = f"{prefix}{title}"
        stripped = body.lstrip()
        if stripped.startswith(candidate):
            rest = stripped[len(candidate):]
            # Only strip if the heading is its own line (guard against
            # matching "## Title Extra Words").
            if rest == "" or rest[0] == "\n":
                return rest.lstrip("\n")
    return body
```

Wired into `render_page_md`:

```python
body_content = _strip_leading_title(page.body, page.title)
body = f"# {page.title}\n\n{body_content}\n"
```

Exact title-equality match, word-boundary-aware via the newline check.

### Issue 5 — Block-HTML guardrail (`backend/kb/agents/compile.py`)

```python
BLOCK_HTML_TAGS = ("table", "p", "div", "td", "tr", "thead", "tbody",
                   "th", "ul", "ol", "li")
BLOCK_HTML_RE = re.compile(
    r"<\s*(" + "|".join(BLOCK_HTML_TAGS) + r")\b[^>]*>",
    re.IGNORECASE,
)

def _assert_no_block_html(self, output: CompileOutput) -> None:
    for page in output.pages:
        if BLOCK_HTML_RE.search(page.body):
            logger.error("compile.block_html_present", extra={"slug": page.slug})
            raise LLMUpstreamError(
                "LLM output contained raw HTML block tags; markdown expected."
            )
```

Wired in `compile()`:

```python
if self._require_verbatim:
    self._assert_verbatim(output, raw_content)
self._assert_no_block_html(output)
self._assert_coverage(output, raw_content)
```

No env-var knob. Strictness values chosen in brainstorming (Q3: block-tag only; Q4: strict schema; Q5: prompt + programmatic dedup) are final.

## Testing strategy

All changes follow TDD per `.claude/CLAUDE.md`.

### Backend tests (colocated with existing compile tests)

1. `test_related_non_slug_rejected` — craft a `CompileOutput` JSON blob with `related: ["/docs/foo"]`; feed it through `CompileOutput.model_validate_json`; assert pydantic `ValidationError`.
2. `test_compile_rejects_when_llm_returns_non_slug_related` — patch `litellm.acompletion` to return JSON with a bogus `related` entry; assert `CompileAgent.compile(...)` raises `LLMUpstreamError`.
3. `test_assert_no_block_html_rejects_table` — body containing `<table>…</table>`; assert `LLMUpstreamError`.
4. `test_assert_no_block_html_allows_inline_tags` — body containing `<br/>`, `<sub>text</sub>`, `<details>`; assert passes.
5. `test_compile_rejects_when_llm_returns_block_html` — patch the LLM response to return a valid-schema page whose body contains `<table>`; assert `compile()` raises `LLMUpstreamError` and `fs.list_pages()` is unchanged.
6. `test_render_page_md_strips_leading_h1_title` — `body="# Foo\n\nIntro."`, `title="Foo"`; assert rendered output has no duplicate `# Foo` in the body.
7. `test_render_page_md_strips_leading_h2_title` — same with `## Foo`.
8. `test_render_page_md_preserves_body_when_title_not_repeated` — body doesn't start with the title; output byte-identical to today.
9. `test_render_page_md_does_not_strip_title_substring_match` — body starts with `## Foo Extra`, `title="Foo"`; leading heading preserved.

### Frontend tests (`frontend/src/components/__tests__/WikiPageViewer.test.tsx`)

10. `renders a GFM pipe table` — mount `<WikiPageViewer content="| a | b |\n|---|---|\n| 1 | 2 |" />`; assert `getByRole('table')` present with `td`s containing "1" and "2".
11. Existing tests remain green (no change to `withLines` or the `components` map).

### Not tested (YAGNI)

- Exact prompt wording (exercised functionally by tests 2 and 5).
- Case-insensitive HTML matching (`IGNORECASE` is on; adding `<TABLE>` tests would be defensive overkill).

### Verification commands

- Backend: `cd backend && .venv/bin/ruff check . && .venv/bin/pytest` → both green.
- Frontend: `cd frontend && pnpm lint && pnpm test` → both green.

## Rollout

One PR, one deploy. No staged rollout, no data migration, no API shape change — all changes are additive gates or rendering improvements.

Suggested implementation order (for the plan step):

1. Frontend `remark-gfm` (smallest, fully isolated, immediately fixes rendering for correctly-formatted pages).
2. Backend schema + prompt + block-HTML guardrail (single coherent backend change).
3. `render_page_md` duplicate-title strip.

## Follow-ups (not in scope)

- **Regenerate broken pages** — after merge, delete `wiki/pages/*.md`, `wiki/index.md`, `wiki/log.md`, then re-ingest the raws. Manual step, chosen by user in brainstorming.
- **Grow `LintAgent`** — add cross-page checks: dangling `[[slug]]` references, `related:` entries pointing at nonexistent pages, duplicate stub pages, index↔page drift. Fits lint's "report" role because these need cross-page visibility that compile doesn't have.
- **Chat streaming markdown render** — if the same no-GFM issue exists on `ChatPage`'s rendered messages, fix in a separate change.

## Commit policy

Per `.claude/CLAUDE.md`, no `git commit` / `git push` / `gh pr create` without explicit user request in the implementing session. The spec file itself is suggested for commit after user review; the implementer should surface commit suggestions and wait.
