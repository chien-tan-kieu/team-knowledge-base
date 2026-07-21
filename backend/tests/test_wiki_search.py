from kb.wiki.fs import WikiFS
from kb.wiki.search import WikiSearch


def _fs(knowledge_dir, schema_dir):
    return WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")


def test_empty_corpus_returns_empty(knowledge_dir, schema_dir):
    search = WikiSearch(_fs(knowledge_dir, schema_dir))
    assert search.search("anything") == []


def test_empty_query_returns_empty(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page("deploy", "---\ntitle: Deploy\n---\n# Deploy\n\nShip it.\n")
    search = WikiSearch(fs)
    assert search.search("   ") == []


def test_ranks_relevant_page_first(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy",
        "---\ntitle: Deploy Process\n---\n# Deploy Process\n\n"
        "How we deploy to production with rollbacks.\n",
    )
    fs.write_page(
        "onboarding",
        "---\ntitle: Onboarding\n---\n# Onboarding\n\n"
        "First week for a new engineer.\n",
    )
    search = WikiSearch(fs)
    results = search.search("deploy production")
    assert results[0]["slug"] == "deploy"


def test_no_match_returns_empty(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page("deploy", "---\ntitle: Deploy\n---\n# Deploy\n\nShip it.\n")
    search = WikiSearch(fs)
    assert search.search("kangaroo marsupial") == []


def test_result_shape_and_snippet(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy",
        "---\ntitle: Deploy Process\n---\n# Deploy Process\n\n"
        "We deploy to production every afternoon.\n",
    )
    search = WikiSearch(fs)
    [hit] = search.search("production")
    assert hit["slug"] == "deploy"
    assert hit["title"] == "Deploy Process"
    assert "production" in hit["snippet"].lower()


def test_title_falls_back_to_slug(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page("no-title", "# No Title\n\nContains the word widget.\n")
    search = WikiSearch(fs)
    [hit] = search.search("widget")
    assert hit["title"] == "no-title"


def test_index_rebuilds_after_page_change(knowledge_dir, schema_dir):
    fs = _fs(knowledge_dir, schema_dir)
    fs.write_page("deploy", "---\ntitle: Deploy\n---\n# Deploy\n\nShip it.\n")
    search = WikiSearch(fs)
    assert search.search("widget") == []
    fs.write_page("gadget", "---\ntitle: Gadget\n---\n# Gadget\n\nA widget factory.\n")
    results = search.search("widget")
    assert [r["slug"] for r in results] == ["gadget"]
