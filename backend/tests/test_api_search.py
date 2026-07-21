import pytest
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs, get_wiki_search
from kb.wiki.fs import WikiFS
from kb.wiki.search import WikiSearch
from tests.conftest import authenticate


@pytest.fixture
def client(knowledge_dir, schema_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir, schema_dir, knowledge_dir / "raw")
    fs.write_page(
        "deploy",
        "---\ntitle: Deploy Process\n---\n# Deploy Process\n\n"
        "How we deploy to production safely.\n",
    )
    search = WikiSearch(fs)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    app.dependency_overrides[get_wiki_search] = lambda: search
    tc = TestClient(app)
    authenticate(tc)
    return tc, fs


def test_search_returns_results(client):
    tc, _ = client
    resp = tc.get("/api/search", params={"q": "production"})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results[0]["slug"] == "deploy"
    assert results[0]["title"] == "Deploy Process"
    assert "production" in results[0]["snippet"].lower()


def test_search_blank_query_returns_empty(client):
    tc, _ = client
    resp = tc.get("/api/search", params={"q": "   "})
    assert resp.status_code == 200
    assert resp.json() == {"results": []}


def test_search_missing_query_returns_empty(client):
    tc, _ = client
    resp = tc.get("/api/search")
    assert resp.status_code == 200
    assert resp.json() == {"results": []}


def test_search_no_match_returns_empty(client):
    tc, _ = client
    resp = tc.get("/api/search", params={"q": "kangaroo"})
    assert resp.status_code == 200
    assert resp.json() == {"results": []}


def test_search_requires_auth(knowledge_dir, schema_dir):
    app = create_app()
    tc = TestClient(app)  # no authenticate()
    resp = tc.get("/api/search", params={"q": "production"})
    assert resp.status_code == 401
