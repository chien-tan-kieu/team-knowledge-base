# Wiki Schema

The authoritative schema for compile output lives in code: `backend/kb/agents/compile_schema.py`. The `CompileAgent` asks the LLM for a `CompileOutput` via LiteLLM's `response_format` JSON-Schema mode, validates the output, then renders the Markdown for every page, the index, and the log entry in code.

## Page Format (rendered in code)

Every wiki page in `wiki/pages/` has YAML frontmatter followed by a free-form Markdown body:

```markdown
---
slug: <slug>
title: <Page Title>
summary: One-paragraph synopsis used by the index.
related: [other-slug, another-slug]
sources: [raw-filename-1.md, raw-filename-2.md]
updated: YYYY-MM-DD
edited_by: llm
---

# <Page Title>

<Body. Free-form Markdown. Whatever subheadings the concept needs.
Tables, code blocks, block quotes from the source appear verbatim.
No required sub-sections.>
```

Frontmatter fields:

- `slug` — lowercase, hyphen-separated. Regex `^[a-z0-9]+(-[a-z0-9]+)*$`. Matches the filename stem.
- `title` — human-readable. Rendered as the body's first `#` heading.
- `summary` — single paragraph, used verbatim as the index bullet.
- `related` — list of other slugs. Empty list if none.
- `sources` — list of raw filenames inside `knowledge/raw/`. Grows on re-ingest.
- `updated` — ISO date (`YYYY-MM-DD`). Advances on every compiler write.
- `edited_by` — `llm` or `human`. Write-protect flag.

## Human Edits

A page is the human's when its frontmatter says `edited_by: human`. Humans set this flag manually when they save an edit — there is no file watcher. The `CompileAgent` treats any `edited_by: human` page as write-protected:

- The existing frontmatter and body are preserved.
- New compiled content is appended inside a `## Proposed updates (from <raw_filename>)` block.
- Re-ingesting the same raw replaces only the matching block; older blocks from other raws stay intact.
- Humans accept a proposal by copying content from the block into the main body and deleting the block.

## Body Rules

- At least 200 characters. This is enforced by the `WikiPageOutput.body` schema.
- Every fenced code block and Markdown table in the raw source must appear verbatim in the body of some page. The compiler rejects output that drops them.
- Prose may be rephrased; numeric facts, named entities, code blocks, and tables are verbatim.

## Coverage Floor

`sum(len(summary) + len(body))` across all pages ≥ `COMPILE_MIN_COVERAGE` × `len(raw_content)`. Default `0.7`. Configurable via the `COMPILE_MIN_COVERAGE` env var.

## Index Format (rendered in code)

`wiki/index.md` is fully regenerated on every ingest from the union of existing index entries and new page summaries:

```
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

- [[slug-name]] — Summary string from frontmatter
```

Slugs are sorted alphabetically. The bullet text is the `summary` frontmatter field of the current page (or the prior index entry if the page was not touched by this ingest).

## Log Format (rendered in code)

Each ingest appends an entry. Empty categories are omitted:

```
## [YYYY-MM-DD] ingest | <filename>
Created: slug-a, slug-b
Updated: slug-c
Proposed updates queued: slug-d
```

## Naming Conventions

- One page per distinct concept, entity, or process. The compile prompt instructs the LLM to split aggressively.
- Backlinks use `[[slug]]` syntax inside Markdown prose.
- A page's body should be substantial (≥ 200 chars, typically more); split long content into sub-pages rather than writing one huge page.

## Migration Note

The prior template (`# Title` + `**Slug:** / **Related:** / **Last updated:**` header block + `## Summary / ## Details / ## References`) is obsolete. Pages from that era must be regenerated: delete `wiki/pages/*.md`, `wiki/index.md`, and `wiki/log.md`, then re-ingest the relevant `raw/` files.
