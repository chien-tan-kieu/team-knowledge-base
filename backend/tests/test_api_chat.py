import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS
from tests.conftest import authenticate


async def _mock_query(question: str):
    for token in ["The ", "answer ", "is here."]:
        yield token


@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    tc = TestClient(app)
    authenticate(tc)
    return tc, fs


def test_chat_returns_sse_stream(client):
    tc, _ = client
    with patch("kb.api.chat.QueryAgent") as MockAgent:
        MockAgent.return_value.query = _mock_query
        response = tc.post(
            "/api/chat",
            json={"question": "How do I deploy?"},
            headers={"Accept": "text/event-stream"},
        )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "answer" in response.text


def test_chat_rejects_empty_question(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"question": ""})
    assert response.status_code == 422
