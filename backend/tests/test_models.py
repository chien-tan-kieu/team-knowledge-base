from pydantic import ValidationError
import pytest
from kb.wiki.models import WikiPage, IngestJob, JobStatus, ChatRequest, ChatTurn, LintResult


def test_wiki_page_slug_from_filename():
    content = "---\nslug: database-migrations\n---\n# Database Migrations\n\nContent here."
    page = WikiPage(
        slug="database-migrations",
        content=content,
        frontmatter={"slug": "database-migrations"},
        body="# Database Migrations\n\nContent here."
    )
    assert page.slug == "database-migrations"
    assert "Database Migrations" in page.content


def test_ingest_job_defaults_to_pending():
    job = IngestJob(job_id="abc-123", filename="guide.md")
    assert job.status == JobStatus.PENDING
    assert job.error is None


def test_lint_result_has_issues_list():
    result = LintResult(orphans=["old-page"], contradictions=[])
    assert "old-page" in result.orphans
    assert result.contradictions == []


def test_chat_request_accepts_messages_list():
    req = ChatRequest(messages=[
        ChatTurn(role="user", content="hi"),
        ChatTurn(role="assistant", content="hello"),
        ChatTurn(role="user", content="again"),
    ])
    assert len(req.messages) == 3
    assert req.messages[0].role == "user"


def test_chat_turn_rejects_invalid_role():
    with pytest.raises(ValidationError):
        ChatTurn(role="system", content="x")
