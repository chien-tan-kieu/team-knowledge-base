import os
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")
os.environ.setdefault("KNOWLEDGE_DIR", "/tmp/kb-test")

import pytest
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def knowledge_dir(tmp_path: Path) -> Path:
    (tmp_path / "raw").mkdir()
    (tmp_path / "wiki" / "pages").mkdir(parents=True)
    (tmp_path / "wiki" / "index.md").write_text("# Index\n\n")
    (tmp_path / "wiki" / "log.md").write_text("")
    return tmp_path


@pytest.fixture
def schema_dir(tmp_path: Path) -> Path:
    d = tmp_path / "schema"
    d.mkdir()
    (d / "SCHEMA.md").write_text("# Schema\n\n")
    return d


def authenticate(tc: TestClient) -> TestClient:
    """Call the session bootstrap so the client's cookie jar has kb_session."""
    resp = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 204, resp.text
    return tc
