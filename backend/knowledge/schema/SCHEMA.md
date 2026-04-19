# Wiki Schema

The authoritative schema for compile output lives in code: `backend/kb/agents/compile_schema.py`. The `CompileAgent` asks the LLM for a `CompileOutput` via LiteLLM's `response_format` JSON-Schema mode, then renders the Markdown for each page, the index, and the log entry in code. The LLM never composes Markdown layout directly.

## Page Format (rendered in code)

Every wiki page in `wiki/pages/` is rendered from a `WikiPageOutput` and has this exact structure:

```markdown
# <Page Title>

**Slug:** <slug>
**Related:** [[other-slug]], [[another-slug]]   (or "(none)")
**Last updated:** YYYY-MM-DD

## Summary

One paragraph summary.

## Details

Full content for this concept. Markdown subheadings, lists, tables, and code blocks allowed.

## References

- Source: `raw/<filename>`
```

Because the template is rendered in `render_page_md`, it cannot drift. If a field is missing, Pydantic rejects the LLM output before rendering.

## Index Format (rendered in code)

`wiki/index.md` is fully regenerated on every ingest by `render_index_md` from the union of (existing index entries) ∪ (new page summaries):

```
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

- [[slug-name]] — First line of the page summary
```

Slugs are sorted alphabetically.

## Log Format (rendered in code)

Each log entry is appended by `render_log_entry`:

```
## [YYYY-MM-DD] ingest | <filename>
Pages touched: slug-one, slug-two, slug-three
```

## Naming Conventions

- Slugs: lowercase, hyphen-separated, no extension, no path separators. Validated by Pydantic regex `^[a-z0-9]+(-[a-z0-9]+)*$`.
- One page per distinct concept, entity, or process. The compile prompt explicitly instructs the LLM to split aggressively.
- Backlinks use `[[slug]]` syntax.
- A page should be ≤500 words in the Details section; split longer content into sub-pages.

## Coverage

The `CompileAgent` rejects compiles whose `sum(len(summary) + len(details))` across all pages is below `COMPILE_MIN_COVERAGE` × `len(raw_content)` (default 0.2). This fights silent over-summarization.
