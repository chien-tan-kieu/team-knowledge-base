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
