import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from kb.main import create_app
from kb.api.deps import get_wiki_fs, get_job_store
from kb.wiki.fs import WikiFS
from kb.wiki.models import JobStatus
from kb.jobs.store import InMemoryJobStore
from tests.conftest import authenticate


@pytest.fixture
def client(knowledge_dir, schema_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir, schema_dir)
    store = InMemoryJobStore()
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    app.dependency_overrides[get_job_store] = lambda: store
    tc = TestClient(app)
    authenticate(tc)
    return tc, store


def test_ingest_returns_job_id(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        content = b"# Guide\n\nContent."
        response = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
    assert response.status_code == 202
    assert "job_id" in response.json()


def test_get_job_status(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        content = b"# Guide\n\nContent."
        post_resp = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
    job_id = post_resp.json()["job_id"]
    get_resp = tc.get(f"/api/ingest/{job_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["job_id"] == job_id


def test_get_missing_job_returns_404(client):
    tc, _ = client
    response = tc.get("/api/ingest/no-such-id")
    assert response.status_code == 404


def test_ingest_failure_stores_generic_message_not_exception_str(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock(
            side_effect=RuntimeError("secret/path/leaked.py line 42")
        )
        content = b"# Guide\n\nContent."
        resp = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]

        # TestClient's sync client waits for BackgroundTasks to complete before
        # returning the response — so the job is already in terminal state here.
        job = store.get_job(job_id)
        assert job.status == JobStatus.FAILED
        assert job.error == "Ingest failed."
        assert "secret/path" not in (job.error or "")


def test_get_failed_job_returns_500(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock(
            side_effect=RuntimeError("compile error")
        )
        content = b"# Guide\n\nContent."
        post_resp = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
        job_id = post_resp.json()["job_id"]

        get_resp = tc.get(f"/api/ingest/{job_id}")
        assert get_resp.status_code == 500
        body = get_resp.json()
        assert body["code"] == "INTERNAL_ERROR"
        assert body["message"] == "Ingest failed."
        assert "request_id" in body


def test_sync_vault_creates_jobs_for_unprocessed_files(client):
    tc, store = client
    knowledge_dir_path = tc.app.dependency_overrides[get_wiki_fs]()._raw.parent

    # Drop a raw file that has no log entry
    (knowledge_dir_path / "raw" / "new-doc.md").write_text("# New\n\nContent.")

    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        resp = tc.post("/api/ingest/sync")

    assert resp.status_code == 202
    body = resp.json()
    assert len(body["jobs"]) == 1
    assert body["jobs"][0]["filename"] == "new-doc.md"
    assert "job_id" in body["jobs"][0]


def test_sync_vault_skips_already_processed_files(client):
    tc, store = client
    knowledge_dir_path = tc.app.dependency_overrides[get_wiki_fs]()._raw.parent

    (knowledge_dir_path / "raw" / "existing.md").write_text("# Existing")
    (knowledge_dir_path / "wiki" / "log.md").write_text(
        "## [2026-05-01] ingest | existing.md\nCreated: some-page\n"
    )

    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        resp = tc.post("/api/ingest/sync")

    assert resp.status_code == 202
    assert resp.json()["jobs"] == []


def test_sync_vault_returns_empty_when_raw_is_empty(client):
    tc, _ = client
    resp = tc.post("/api/ingest/sync")
    assert resp.status_code == 202
    assert resp.json() == {"jobs": []}


def test_sync_vault_is_idempotent(client):
    tc, store = client
    knowledge_dir_path = tc.app.dependency_overrides[get_wiki_fs]()._raw.parent

    (knowledge_dir_path / "raw" / "doc.md").write_text("# Doc")

    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        resp1 = tc.post("/api/ingest/sync")
        job_id = resp1.json()["jobs"][0]["job_id"]

        # Mark it done + write log entry so second call skips it
        store.update_job(job_id, status=JobStatus.DONE)
        (knowledge_dir_path / "wiki" / "log.md").write_text(
            f"## [2026-05-02] ingest | doc.md\nCreated: doc-page\n"
        )
        resp2 = tc.post("/api/ingest/sync")

    assert resp2.json()["jobs"] == []
