import os
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def knowledge_dir(tmp_path: Path) -> Path:
    (tmp_path / "raw").mkdir()
    (tmp_path / "wiki" / "pages").mkdir(parents=True)
    (tmp_path / "schema").mkdir()
    (tmp_path / "wiki" / "index.md").write_text("# Index\n\n")
    (tmp_path / "wiki" / "log.md").write_text("")
    (tmp_path / "schema" / "SCHEMA.md").write_text("# Schema\n\n")
    return tmp_path


def authenticate(tc: TestClient) -> TestClient:
    """Call the session bootstrap so the client's cookie jar has kb_session."""
    resp = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 204, resp.text
    return tc
