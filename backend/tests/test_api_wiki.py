import pytest
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS
from tests.conftest import authenticate


@pytest.fixture
def client(knowledge_dir, schema_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir, schema_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\n"
        "# Deploy Process\n\nRun `make deploy`.\n",
    )
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")
    tc = TestClient(app)
    authenticate(tc)
    return tc, fs


def test_list_wiki_pages(client):
    tc, _ = client
    response = tc.get("/api/wiki")
    assert response.status_code == 200
    slugs = response.json()["pages"]
    assert "deploy-process" in slugs


def test_get_wiki_page(client):
    tc, _ = client
    response = tc.get("/api/wiki/deploy-process")
    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "deploy-process"
    assert "Deploy Process" in data["content"]


def test_get_missing_wiki_page_returns_404(client):
    tc, _ = client
    response = tc.get("/api/wiki/nonexistent")
    assert response.status_code == 404
