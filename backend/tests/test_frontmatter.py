import pytest

from kb.wiki.frontmatter import dump, parse


def test_parse_extracts_frontmatter_and_body():
    md = (
        "---\n"
        "slug: foo\n"
        "title: Foo\n"
        "related: []\n"
        "---\n"
        "# Foo\n\nBody content.\n"
    )
    fm, body = parse(md)
    assert fm == {"slug": "foo", "title": "Foo", "related": []}
    assert body == "# Foo\n\nBody content.\n"


def test_parse_rejects_missing_frontmatter():
    with pytest.raises(ValueError, match="frontmatter"):
        parse("# Foo\nno frontmatter here\n")


def test_parse_rejects_unclosed_frontmatter():
    with pytest.raises(ValueError, match="frontmatter"):
        parse("---\nslug: foo\n# body without close\n")


def test_parse_rejects_invalid_yaml():
    with pytest.raises(ValueError, match="YAML"):
        parse("---\nslug: [unclosed\n---\nbody\n")


def test_dump_round_trips_parse():
    fm = {"slug": "foo", "title": "Foo", "related": ["bar"]}
    body = "# Foo\n\nBody.\n"
    text = dump(fm, body)
    fm2, body2 = parse(text)
    assert fm2 == fm
    assert body2 == body


def test_dump_produces_block_style_yaml():
    text = dump({"slug": "foo", "related": ["a", "b"]}, "body\n")
    assert "related:\n- a\n- b\n" in text
