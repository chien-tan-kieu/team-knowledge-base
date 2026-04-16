# Wiki Schema

## Page Format

Each wiki page in `wiki/pages/` is a markdown file with this structure:

```markdown
# Page Title

**Slug:** slug-name
**Related:** [[other-slug]], [[another-slug]]
**Last updated:** YYYY-MM-DD

## Summary

One paragraph summary of this concept/entity/topic.

## Details

Full content, can be multiple sections.

## References

- Source: `raw/filename.md`
```

## Index Format

`wiki/index.md` contains a flat list of all pages, one per line:

```
- [[slug-name]] — One sentence description
```

The CompileAgent updates this list on every ingest.

## Log Format

Each log entry in `wiki/log.md`:

```
## [2026-04-16] ingest | Document Title
Pages touched: slug-one, slug-two, slug-three
```

## Naming Conventions

- Slugs: lowercase, hyphen-separated, no special chars (e.g. `database-migrations`)
- One page per distinct concept, entity, or process
- Backlinks use `[[slug]]` syntax
- A page should be ≤500 words; split longer content into sub-pages

## Agent Output Format

When the CompileAgent writes pages, it uses this delimiter format:

```
=== PAGE: slug-name ===
(full markdown content of the page)

=== INDEX ===
(full updated content of index.md)

=== LOG_ENTRY ===
## [YYYY-MM-DD] ingest | Document Title
Pages touched: slug-one, slug-two
```

The parser splits on `=== PAGE: `, `=== INDEX ===`, and `=== LOG_ENTRY ===`.
