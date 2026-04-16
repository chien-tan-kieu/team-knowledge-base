from kb.wiki.models import WikiPage, IngestJob, JobStatus, ChatRequest, LintResult


def test_wiki_page_slug_from_filename():
    page = WikiPage(slug="database-migrations", content="# Database Migrations\n\nContent here.")
    assert page.slug == "database-migrations"
    assert "Database Migrations" in page.content


def test_ingest_job_defaults_to_pending():
    job = IngestJob(job_id="abc-123", filename="guide.md")
    assert job.status == JobStatus.PENDING
    assert job.error is None


def test_chat_request_requires_question():
    req = ChatRequest(question="How do we deploy?")
    assert req.question == "How do we deploy?"


def test_lint_result_has_issues_list():
    result = LintResult(orphans=["old-page"], contradictions=[])
    assert "old-page" in result.orphans
    assert result.contradictions == []
