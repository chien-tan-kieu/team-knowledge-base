import pytest
from kb.wiki.fs import WikiFS


def test_read_index(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    content = fs.read_index()
    assert "# Index" in content


def test_write_and_read_page(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page(
        "test-topic",
        "---\nslug: test-topic\ntitle: Test Topic\n---\n# Test Topic\n\nContent here.\n",
    )
    page = fs.read_page("test-topic")
    assert page.slug == "test-topic"
    assert "Test Topic" in page.content


def test_read_missing_page_raises(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    try:
        fs.read_page("nonexistent")
        assert False, "Should have raised"
    except FileNotFoundError:
        pass


def test_list_pages_empty(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    assert fs.list_pages() == []


def test_list_pages_after_write(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page("topic-a", "# A")
    fs.write_page("topic-b", "# B")
    slugs = fs.list_pages()
    assert "topic-a" in slugs
    assert "topic-b" in slugs


def test_append_log(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.append_log("## [2026-04-16] ingest | Test Doc\nPages touched: topic-a")
    content = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "Test Doc" in content


def test_save_and_read_raw(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.save_raw("guide.md", "# Guide\n\nContent.")
    content = fs.read_raw("guide.md")
    assert "Guide" in content


def test_delete_raw_removes_file(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.save_raw("guide.md", "# Guide\n\nContent.")
    fs.delete_raw("guide.md")
    assert not (knowledge_dir / "raw" / "guide.md").exists()


def test_delete_raw_missing_file_raises(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    with pytest.raises(FileNotFoundError):
        fs.delete_raw("nonexistent.md")


def test_write_index(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_index("# Index\n\n- [[topic-a]] — A topic\n")
    assert "topic-a" in fs.read_index()


def test_read_schema(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    content = fs.read_schema()
    assert "# Schema" in content


def test_read_page_parses_frontmatter_and_body(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    (knowledge_dir / "wiki" / "pages" / "foo.md").write_text(
        "---\n"
        "slug: foo\n"
        "title: Foo\n"
        "---\n"
        "# Foo\n\nBody.\n",
        encoding="utf-8",
    )
    page = fs.read_page("foo")
    assert page.slug == "foo"
    assert page.frontmatter == {"slug": "foo", "title": "Foo"}
    assert page.body == "# Foo\n\nBody.\n"
    assert page.content.startswith("---\n")


def test_read_page_raises_on_missing_frontmatter(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    (knowledge_dir / "wiki" / "pages" / "bar.md").write_text(
        "# Bar\n\nNo frontmatter.\n", encoding="utf-8"
    )
    with pytest.raises(ValueError, match="frontmatter"):
        fs.read_page("bar")


def test_raw_dir_independent_of_knowledge_dir(tmp_path, schema_dir):
    knowledge_dir = tmp_path / "vault"
    knowledge_dir.mkdir()
    raw_dir = tmp_path / "raw-fixed"
    fs = WikiFS(knowledge_dir, schema_dir, raw_dir)
    fs.save_raw("guide.md", "# Guide")
    assert (raw_dir / "guide.md").exists()
    assert not (knowledge_dir / "raw" / "guide.md").exists()


def test_list_raw_files_returns_md_only(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    (knowledge_dir / "raw" / "guide.md").write_text("# Guide")
    (knowledge_dir / "raw" / "notes.md").write_text("# Notes")
    (knowledge_dir / "raw" / ".gitkeep").write_text("")
    assert fs.list_raw_files() == ["guide.md", "notes.md"]


def test_list_raw_files_empty(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    assert fs.list_raw_files() == []


def test_read_log_returns_content(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    (knowledge_dir / "wiki" / "log.md").write_text("## [2026-05-01] ingest | guide.md\n")
    assert "guide.md" in fs.read_log()


def test_read_log_returns_empty_string_when_absent(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    (knowledge_dir / "wiki" / "log.md").unlink()
    assert fs.read_log() == ""


def test_init_creates_missing_index_and_log(tmp_path, schema_dir):
    fs = WikiFS(tmp_path, schema_dir, tmp_path / "raw")
    assert (tmp_path / "wiki" / "index.md").exists()
    assert (tmp_path / "wiki" / "log.md").exists()
    assert fs.read_index() == "# Index\n\n"
    assert fs.read_log() == ""


def test_init_preserves_existing_index_and_log(knowledge_dir, schema_dir):
    (knowledge_dir / "wiki" / "index.md").write_text(
        "# Index\n\n- [[foo]] — bar\n", encoding="utf-8"
    )
    (knowledge_dir / "wiki" / "log.md").write_text("## existing entry\n")
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    assert "foo" in fs.read_index()
    assert "existing entry" in fs.read_log()


def test_list_page_meta_with_topic(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page(
        "bmad",
        "---\nslug: bmad\ntitle: BMAD\ntopic: spec-tools\n---\n# BMAD\n\nBody.\n",
    )
    assert fs.list_page_meta() == [
        {"slug": "bmad", "title": "BMAD", "topic": "spec-tools"}
    ]


def test_list_page_meta_without_topic(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page(
        "old-page",
        "---\nslug: old-page\ntitle: Old Page\n---\n# Old Page\n\nBody.\n",
    )
    assert fs.list_page_meta() == [
        {"slug": "old-page", "title": "Old Page", "topic": None}
    ]


def test_list_page_meta_tolerates_invalid_frontmatter(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page("broken", "# No frontmatter here\n\nJust a body.\n")
    assert fs.list_page_meta() == [
        {"slug": "broken", "title": None, "topic": None}
    ]


def test_list_page_meta_rejects_non_slug_topic(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page(
        "weird",
        "---\nslug: weird\ntitle: Weird\ntopic: Not A Slug\n---\nBody.\n",
    )
    assert fs.list_page_meta() == [
        {"slug": "weird", "title": "Weird", "topic": None}
    ]


def test_list_page_meta_sorted_by_slug(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page("zeta", "---\nslug: zeta\ntitle: Z\n---\nBody.\n")
    fs.write_page("alpha", "---\nslug: alpha\ntitle: A\n---\nBody.\n")
    assert [m["slug"] for m in fs.list_page_meta()] == ["alpha", "zeta"]
