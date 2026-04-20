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
from kb.wiki.frontmatter import parse as parse_frontmatter


def _valid_page_kwargs(**overrides):
    base = {
        "slug": "foo-bar",
        "title": "Foo Bar",
        "summary": "A one-paragraph summary.",
        "related": [],
        "body": "x" * 250,
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


def test_body_min_length_200():
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(body="short"))


def test_compile_output_requires_at_least_one_page():
    with pytest.raises(ValidationError):
        CompileOutput(pages=[])


def test_render_page_md_produces_frontmatter_plus_body():
    page = WikiPageOutput(**_valid_page_kwargs(related=["other-slug"]))
    md = render_page_md(
        page,
        sources=["source.md"],
        updated=date(2026, 4, 20),
        edited_by="llm",
    )
    fm, body = parse_frontmatter(md)
    assert fm == {
        "slug": "foo-bar",
        "title": "Foo Bar",
        "summary": "A one-paragraph summary.",
        "related": ["other-slug"],
        "sources": ["source.md"],
        "updated": date(2026, 4, 20),
        "edited_by": "llm",
    }
    assert body.startswith("# Foo Bar\n")
    assert ("x" * 250) in body


def test_render_page_md_empty_related():
    page = WikiPageOutput(**_valid_page_kwargs(related=[]))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    fm, _ = parse_frontmatter(md)
    assert fm["related"] == []


def test_render_page_md_edited_by_human():
    page = WikiPageOutput(**_valid_page_kwargs())
    md = render_page_md(
        page,
        sources=["s.md"],
        updated=date(2026, 4, 20),
        edited_by="human",
    )
    fm, _ = parse_frontmatter(md)
    assert fm["edited_by"] == "human"


def test_render_index_md_sorts_slugs():
    md = render_index_md({"zebra": "last one", "apple": "first one"})
    assert md.index("[[apple]]") < md.index("[[zebra]]")
    assert "first one" in md
    assert "last one" in md


def test_render_log_entry_three_categories():
    entry = render_log_entry(
        "doc.md",
        created=["a"],
        updated=["b"],
        proposed=["c"],
        today=date(2026, 4, 20),
    )
    assert entry.startswith("## [2026-04-20] ingest | doc.md\n")
    assert "Created: a" in entry
    assert "Updated: b" in entry
    assert "Proposed updates queued: c" in entry


def test_render_log_entry_omits_empty_categories():
    entry = render_log_entry(
        "doc.md", created=["a", "b"], updated=[], proposed=[], today=date(2026, 4, 20)
    )
    assert "Created: a, b" in entry
    assert "Updated:" not in entry
    assert "Proposed updates queued:" not in entry
