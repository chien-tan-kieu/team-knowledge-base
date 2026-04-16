from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS


def test_lint_returns_result(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    fs.write_page("orphan", "# Orphan")
    fs.write_index("# Index\n\n")
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    tc = TestClient(app)
    response = tc.post("/api/lint")
    assert response.status_code == 200
    data = response.json()
    assert "orphans" in data
    assert "orphan" in data["orphans"]
