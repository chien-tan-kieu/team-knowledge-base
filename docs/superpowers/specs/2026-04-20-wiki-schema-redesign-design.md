# Wiki Schema Redesign — Frontmatter + Dense Body

**Status:** design approved, ready for implementation planning
**Date:** 2026-04-20
**Scope:** backend only (`backend/kb/agents/compile.py`, `compile_schema.py`, `backend/kb/wiki/fs.py`, `backend/kb/agents/query.py`, `backend/knowledge/schema/SCHEMA.md`, associated tests)

## Problem

The current wiki page template (`# Title / Summary / Details / References: raw/<file>`) and the `CompileAgent` it drives produce pages that are too thin to answer from. Concrete failures on the only existing raw document (`claude-modes-research.md`):

- `wiki/pages/modes-of-claude.md`'s `## Details` is a single generic paragraph; none of the source's specifics are preserved.
- All four generated pages end with `- Source: raw/claude-modes-research.md`, implying the raw file is the real source of truth. The `QueryAgent` never reads raw, so any fact not re-synthesized into the wiki is unreachable.
- The existing guardrails ("DO NOT summarize" in the prompt, 20% coverage floor) do not bite: generic prose easily clears 20%, and the prompt has no verbatim-preservation rule for code blocks or tables.
- The fixed `## Summary / ## Details / ## References` layout forces every concept (entity, comparison, process, synthesis) through the same shape, which fights the Karpathy LLM-wiki pattern where pages are heterogeneous.
- Once the `CompileAgent` runs again on an overlapping source, it silently overwrites any human edits via `WikiFS.write_page(slug, ...)`. Humans have no safe path to curate the wiki.

## Goals

1. Wiki pages carry the actual information, so the `QueryAgent` can answer grounded questions from the wiki alone.
2. Pages are human-reviewable and human-editable; manual edits are not silently clobbered by subsequent ingests.
3. The Karpathy LLM-wiki pattern (markdown-first, heterogeneous page types, flexible body, optional metadata) stays intact.
4. Raw files remain immutable inputs; they do not disappear. The wiki's self-sufficiency comes from synthesis density, not from deleting raw.

## Non-goals

- No new API endpoint or UI surface for reviewing/resolving proposed updates.
- No automatic detection of human edits via git hooks, file watchers, or checksums. The `edited_by: human` flag is author-set and documented.
- No second LLM pass for auditing fidelity.
- No incremental migration tooling for existing pages — the current four pages are test data and will be re-ingested.
- No changes to `LintAgent`, ingest API surface, frontend, or CORS/config wiring beyond the keys called out below.

## Design

### Page template

Every wiki page in `wiki/pages/<slug>.md` has YAML frontmatter followed by a free-form Markdown body.

```markdown
---
slug: modes-of-claude
title: Understanding the Different Modes of Claude
summary: One-paragraph synopsis used by the index.
related: [claude-code-cli, claude-mode-comparison]
sources: [claude-modes-research.md]
updated: 2026-04-20
edited_by: llm
---

# Understanding the Different Modes of Claude

Free-form Markdown body. Whatever sub-headings the concept needs.
Tables, code blocks, and block quotes from the raw source appear
verbatim when present. No required sub-section layout.
```

Frontmatter fields:

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Regex `^[a-z0-9]+(-[a-z0-9]+)*$`, matches filename stem. |
| `title` | string | Human-readable; also rendered as the body's first `#` heading. |
| `summary` | string | One paragraph. Source for the index bullet. |
| `related` | list[string] | Slugs only. Empty list if none. |
| `sources` | list[string] | Raw filenames (inside `knowledge/raw/`). Grows on re-ingest. |
| `updated` | date (ISO `YYYY-MM-DD`) | Advances on every compiler write. |
| `edited_by` | `"llm"` \| `"human"` | Write-protect flag. Compiler only writes with `edited_by: llm`. Humans flip to `"human"` when they edit. |

The body has no required sub-sections. When a page is in a "proposed update pending" state, it also contains one or more trailing blocks of the form:

```markdown
## Proposed updates (from <raw_filename>)

<compiler-generated body for this raw>
```

These blocks appear only on `edited_by: human` pages where the compiler has new content to offer. At most one block per source filename; re-ingesting the same raw replaces the existing block for that filename.

### Compile output schema

`backend/kb/agents/compile_schema.py` becomes:

```python
class WikiPageOutput(BaseModel):
    slug: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    related: list[str]
    body: str = Field(min_length=200)

class CompileOutput(BaseModel):
    pages: list[WikiPageOutput] = Field(min_length=1)
```

The LLM no longer emits the `References` line, the `Summary`/`Details` split, or any rendered layout. It emits a dense body per concept; `render_page_md` assembles frontmatter + `# title` + body.

### Rendering helpers

`backend/kb/agents/compile_schema.py` exposes:

- `render_page_md(page: WikiPageOutput, sources: list[str], updated: date, edited_by: str = "llm") -> str` — assembles the new template. YAML frontmatter is produced via `yaml.safe_dump` for deterministic ordering.
- `render_index_md(slug_to_summary: dict[str, str]) -> str` — unchanged shape; input now comes from frontmatter `summary` values.
- `render_log_entry(filename: str, created: list[str], updated_slugs: list[str], proposed: list[str], today: date) -> str` — three-category form described below. Any empty category line is omitted.

### Frontmatter I/O

`backend/kb/wiki/fs.py` gains a small frontmatter helper (new module `backend/kb/wiki/frontmatter.py`, or private functions inside `fs.py` — implementer's choice):

- `parse(md: str) -> tuple[dict, str]` — splits a page into `(frontmatter_dict, body_str)`. Raises if the file is missing a frontmatter block or the YAML is invalid.
- `dump(frontmatter: dict, body: str) -> str` — inverse, used by `render_page_md`.

`WikiFS.read_page(slug)` returns a small dataclass or named tuple exposing both `frontmatter` and `body` (today it returns raw content). Callers that want the full rendered file can still reach it via `WikiFS._path(slug)` / existing helpers.

Dependency: `pyyaml` added to `backend/pyproject.toml` if not already transitively pinned. Version choice deferred to implementation.

### Pipeline (`CompileAgent.compile`)

Changes are concentrated in `_write`. High-level flow per page in the compile output:

1. Compute `today = date.today()`.
2. Try to load existing page via `WikiFS.read_page(slug)`.
3. **Fresh slug (file not found):** render page with `sources=[filename]`, `edited_by="llm"`, write. Record slug under "created".
4. **Existing page, `edited_by: llm`:** merge new `related` and `sources` lists with the existing frontmatter values (dedup, preserve first-seen order). Render and overwrite. Record slug under "updated".
5. **Existing page, `edited_by: human`:** do not overwrite the file. Edit it in place:
   - Parse existing body, strip any trailing `## Proposed updates (from <filename>)` section for the same `filename`.
   - Append a fresh `## Proposed updates (from <filename>)` block containing the new compiled body.
   - Update `updated` to today and merge `filename` into `sources`. Keep `edited_by: human`.
   - Record slug under "proposed".
6. After all pages are processed:
   - Rebuild the index from the union of existing frontmatter summaries and the new compile's summaries (new values win on collision). `render_index_md` is called with `{slug: summary}`.
   - Append a log entry via `render_log_entry(filename, created, updated_slugs, proposed, today)`.

### Fidelity enforcement

Three layers. All must pass before any page is written; any failure raises `LLMUpstreamError` with a layer-specific message.

1. **Per-page minimum body length — enforced at schema validation.** `body: str = Field(min_length=200)` in `WikiPageOutput`. A Pydantic `ValidationError` during `CompileOutput.model_validate_json` is caught by the existing `except` block in `CompileAgent.compile` and re-raised as `LLMUpstreamError` with the current "did not match the expected schema" message. No new code path.
2. **Verbatim preservation of code blocks and tables — post-validation check.**
   - Extract all fenced code blocks (```` ```lang\n...\n``` ```` or ```` ```\n...\n``` ````) and GitHub-flavored Markdown tables (lines starting with `|` plus a separator row `|---|`) from `raw_content` using regex. No Markdown parser.
   - For each extracted block, verify it appears as a substring in the concatenation of all `page.body` values. If any block is missing, raise `LLMUpstreamError("LLM output dropped a code block or table from the source.")`.
3. **Coverage floor — post-validation check.** `sum(len(p.body) + len(p.summary) for p in pages) / len(raw_content) >= COMPILE_MIN_COVERAGE`. Default raised from `0.2` → `0.7` in `backend/kb/config.py`. Keeps the current message shape.

### Prompt update

`COMPILE_PROMPT` in `backend/kb/agents/compile.py` is reworded to match the new schema and checks:

- No references to `Summary`/`Details`/`References` sections.
- Explicit enumeration of the three validation checks, so the model can anticipate rejection.
- Statement that prose may be rephrased, but code blocks, tables, and numeric/named facts must be preserved verbatim.
- Aggressive-splitting instruction retained, with a per-page ≥200-char body target.
- Reminder that the output schema is `WikiPageOutput` with a `body` field (no rendered Markdown layout).

### Query agent impact

`backend/kb/agents/query.py` changes only in how it assembles the page context for the answer prompt. Today it inlines the full page file (`--- {slug} ---\n{content}`). Under the new template the YAML block would be noise. Change:

- `WikiFS.read_page(slug)` returns `(frontmatter, body)`.
- `QueryAgent` formats each page as `--- {slug}: {title} ---\n{body}` (title pulled from frontmatter; body only).

Selection phase (`SELECT_PROMPT` over the index) is unchanged.

### Index and log

**Index.** Shape unchanged:

```
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

- [[slug]] — Summary text
```

Source of each bullet's summary changes from "first line of `## Summary` section" to "frontmatter `summary` field."

**Log.** Entry gains three category lines; empty categories are omitted:

```
## [2026-04-20] ingest | claude-modes-research.md
Created: mode-selection-guide
Updated: modes-of-claude
Proposed updates queued: claude-mode-comparison
```

### `SCHEMA.md` rewrite

`backend/knowledge/schema/SCHEMA.md` is rewritten to describe the new template authoritatively, including:

- YAML frontmatter field list and types.
- Body rules (free-form, ≥200 chars, verbatim code/tables).
- `edited_by` flag convention and that humans set it to `"human"` manually when editing.
- Proposed-updates block convention.
- Naming conventions (slug regex, one page per concept).
- Fidelity rules (three checks) and the config key that controls the coverage floor.

### Migration of existing wiki data

One-time, manual: delete `backend/knowledge/wiki/pages/*.md`, `backend/knowledge/wiki/index.md`, and `backend/knowledge/wiki/log.md`, then re-ingest `backend/knowledge/raw/claude-modes-research.md`. These files are test data, not production content. `.gitkeep`s stay. This step is documented in `SCHEMA.md`.

### Config

`backend/kb/config.py`:

- `COMPILE_MIN_COVERAGE` default `0.2` → `0.7`. `.env.example` updated.

No other config keys change.

### Error surfaces

The following raise `LLMUpstreamError` with distinct messages, surfaced through the existing ingest-job `error` field:

- Schema validation failure (unchanged path).
- Per-page body < 200 chars (caught by Pydantic; caller wraps into `LLMUpstreamError` as today).
- Missing verbatim code block or table: `"LLM output dropped a code block or table from the source."`
- Coverage floor miss: retains current message with new threshold.

## Testing

- `backend/tests/test_compile_schema.py`: rewrite golden-string assertions for `render_page_md`, `render_index_md`, and `render_log_entry` to match the new template.
- `backend/tests/test_compile_agent.py`: rewrite around the new `WikiPageOutput` schema. Add cases for:
  - Fresh-slug write.
  - Existing `llm` slug overwrite with `sources` merge.
  - Existing `human` slug produces a `## Proposed updates` block; re-ingesting the same raw replaces only that block.
  - Coverage check with new 0.7 default.
  - Verbatim code-block preservation check: a raw with a fenced code block that the model drops → compile rejected.
  - Per-page ≥200-char rejection.
- New tests for the frontmatter parser (`parse` / `dump` round-trip, malformed YAML raises).
- `QueryAgent` tests (if any currently assert on the page formatting passed to the LLM) updated to expect body-only inlining with title header.

## Out of scope

- Tooling or API to surface "pages with pending proposed updates" to operators.
- Automatic flip of `edited_by` on manual save.
- Cross-source synthesis pages (comparison/overview/topic pages that consolidate multiple raws). The current "one page per concept" model is retained.
- Changing the ingest job store, the SSE chat protocol, or any frontend behavior.

## Open questions

None at design time. Implementation questions (exact PyYAML version, whether the frontmatter helper lives in `fs.py` or its own module) are implementer's choice.
