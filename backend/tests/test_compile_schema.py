from datetime import date

import pytest
from pydantic import ValidationError

from kb.agents.compile_schema import (
    CompileOutput,
    WikiPageOutput,
    render_index_md,
    render_log_entry,
    render_page_md,
)


def _valid_page_kwargs(**overrides):
    base = {
        "slug": "foo-bar",
        "title": "Foo Bar",
        "related": [],
        "summary": "A summary.",
        "details": "Some details.",
    }
    base.update(overrides)
    return base


def test_slug_accepts_hyphenated_lowercase():
    WikiPageOutput(**_valid_page_kwargs(slug="claude-code-cli"))
    WikiPageOutput(**_valid_page_kwargs(slug="a1"))


@pytest.mark.parametrize(
    "bad_slug",
    ["Foo", "foo.md", "foo_bar", "foo/bar", "-foo", "foo-", "", "foo--bar"],
)
def test_slug_rejects_invalid(bad_slug):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(slug=bad_slug))


def test_compile_output_requires_at_least_one_page():
    with pytest.raises(ValidationError):
        CompileOutput(pages=[])


def test_render_page_md_contains_all_five_sections():
    page = WikiPageOutput(**_valid_page_kwargs(related=["other-slug"]))
    md = render_page_md(page, "source.md", date(2026, 4, 19))
    assert md.startswith("# Foo Bar\n")
    assert "**Slug:** foo-bar" in md
    assert "[[other-slug]]" in md
    assert "**Last updated:** 2026-04-19" in md
    assert "## Summary" in md
    assert "## Details" in md
    assert "## References" in md
    assert "raw/source.md" in md


def test_render_page_md_handles_empty_related():
    page = WikiPageOutput(**_valid_page_kwargs(related=[]))
    md = render_page_md(page, "s.md", date(2026, 4, 19))
    assert "**Related:** (none)" in md


def test_render_index_md_sorts_slugs():
    md = render_index_md({"zebra": "last one", "apple": "first one"})
    apple_pos = md.index("[[apple]]")
    zebra_pos = md.index("[[zebra]]")
    assert apple_pos < zebra_pos


def test_render_log_entry_format():
    entry = render_log_entry("doc.md", ["a", "b"], date(2026, 4, 19))
    assert entry.startswith("## [2026-04-19] ingest | doc.md")
    assert "Pages touched: a, b" in entry
