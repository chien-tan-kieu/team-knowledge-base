import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from kb.main import create_app
from kb.api.deps import get_wiki_fs, get_job_store
from kb.wiki.fs import WikiFS
from kb.jobs.store import InMemoryJobStore


@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    store = InMemoryJobStore()
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app), store


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
