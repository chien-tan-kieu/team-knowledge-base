from kb.agents.lint import LintAgent
from kb.wiki.fs import WikiFS


def test_lint_finds_orphan_page(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    # Page exists in pages/ but is NOT referenced in index.md
    fs.write_page("orphan-page", "# Orphan\n\nNobody links to me.")
    fs.write_index("# Index\n\n- [[other-page]] — Some other page.\n")

    agent = LintAgent(fs=fs)
    result = agent.lint()

    assert "orphan-page" in result.orphans


def test_lint_no_orphans_when_all_indexed(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page("known-page", "# Known\n\nContent.")
    fs.write_index("# Index\n\n- [[known-page]] — A known page.\n")

    agent = LintAgent(fs=fs)
    result = agent.lint()

    assert "known-page" not in result.orphans


def test_lint_returns_empty_contradictions_without_llm(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    agent = LintAgent(fs=fs)
    result = agent.lint()
    assert result.contradictions == []
