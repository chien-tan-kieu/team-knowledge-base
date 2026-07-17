from datetime import date

import pytest
from pydantic import ValidationError

from kb.agents.compile_schema import (
    CompileOutput,
    WikiPageOutput,
    dehumanize_topic,
    humanize_topic,
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
        "topic": "spec-tools",
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
        "topic": "spec-tools",
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


def test_related_accepts_valid_slugs():
    WikiPageOutput(**_valid_page_kwargs(related=["other-slug", "a1"]))


@pytest.mark.parametrize(
    "bad_slug",
    ["/docs/foo", "Foo", "foo.md", "foo_bar", "foo/bar", "-foo", "foo-", "", "foo--bar"],
)
def test_related_rejects_non_slug(bad_slug):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(related=[bad_slug]))


def test_render_page_md_strips_leading_h1_matching_title():
    body = "# Foo Bar\n\nIntro paragraph. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body.startswith("# Foo Bar\n\nIntro paragraph.")
    assert rendered_body.count("# Foo Bar") == 1


def test_render_page_md_strips_leading_h2_matching_title():
    body = "## Foo Bar\n\nIntro paragraph. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body.startswith("# Foo Bar\n\nIntro paragraph.")
    assert "## Foo Bar" not in rendered_body


def test_render_page_md_preserves_body_when_title_not_repeated():
    body = "Intro paragraph. " + ("x" * 230)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body == f"# Foo Bar\n\n{body}\n"


def test_render_page_md_does_not_strip_title_substring():
    body = "## Foo Bar Extra\n\nContent. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert "## Foo Bar Extra" in rendered_body


def test_render_page_md_injects_see_also_when_related_non_empty():
    page = WikiPageOutput(**_valid_page_kwargs(related=["deploy-process", "ci-cd"]))
    md = render_page_md(page, sources=["src.md"], updated=date(2026, 5, 2))
    assert "## See also" in md
    assert "- [[deploy-process]]" in md
    assert "- [[ci-cd]]" in md


def test_render_page_md_no_see_also_when_related_empty():
    page = WikiPageOutput(**_valid_page_kwargs(related=[]))
    md = render_page_md(page, sources=["src.md"], updated=date(2026, 5, 2))
    assert "## See also" not in md


def test_render_page_md_see_also_after_body():
    page = WikiPageOutput(**_valid_page_kwargs(
        body="x" * 250,
        related=["other-page"],
    ))
    md = render_page_md(page, sources=["src.md"], updated=date(2026, 5, 2))
    body_end = md.rfind("x" * 10)
    see_also_pos = md.find("## See also")
    assert see_also_pos > body_end


def test_topic_accepts_slug_format():
    WikiPageOutput(**_valid_page_kwargs(topic="spec-tools"))
    WikiPageOutput(**_valid_page_kwargs(topic="cognition"))


@pytest.mark.parametrize(
    "bad_topic",
    ["Foo", "foo_bar", "foo/bar", "-foo", "foo-", "", "foo--bar", "foo bar"],
)
def test_topic_rejects_non_slug(bad_topic):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(topic=bad_topic))


@pytest.mark.parametrize("reserved", ["uncategorized", "pages"])
def test_topic_rejects_reserved_names(reserved):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(topic=reserved))


def test_topic_is_required():
    kwargs = _valid_page_kwargs()
    del kwargs["topic"]
    with pytest.raises(ValidationError):
        WikiPageOutput(**kwargs)


def test_render_page_md_includes_topic_in_frontmatter():
    page = WikiPageOutput(**_valid_page_kwargs())
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 7, 17))
    fm, _ = parse_frontmatter(md)
    assert fm["topic"] == "spec-tools"


def test_humanize_topic():
    assert humanize_topic("spec-tools") == "Spec Tools"
    assert humanize_topic("cognition") == "Cognition"


def test_topic_humanize_round_trip_is_lossless():
    assert dehumanize_topic("Spec Tools") == "spec-tools"
    assert dehumanize_topic(humanize_topic("a1-b2-c3")) == "a1-b2-c3"
