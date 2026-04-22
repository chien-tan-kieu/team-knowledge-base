import asyncio
import logging
import pytest
from unittest.mock import patch
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
            json={"messages": [{"role": "user", "content": "How do I deploy?"}]},
            headers={"Accept": "text/event-stream"},
        )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "answer" in response.text


def test_chat_rejects_empty_messages(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": []})
    assert response.status_code == 422


def test_chat_rejects_blank_content(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": [
        {"role": "user", "content": "   "},
    ]})
    assert response.status_code == 422


def test_chat_rejects_non_user_last_turn(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]})
    assert response.status_code == 422


async def _mock_query_raises(question: str):
    yield "hello"
    raise __import__("kb.errors", fromlist=["LLMUpstreamError"]).LLMUpstreamError()


def test_chat_emits_terminal_error_event_on_stream_failure(client):
    tc, _ = client
    with patch("kb.api.chat.QueryAgent") as MockAgent:
        MockAgent.return_value.query = _mock_query_raises
        with tc.stream("POST", "/api/chat", json={"messages": [{"role": "user", "content": "why?"}]}) as resp:
            assert resp.status_code == 200
            body = b"".join(resp.iter_bytes()).decode("utf-8")

    # Expect the partial token then an event: error frame with the flat error json.
    assert "data: hello" in body
    assert "event: error" in body
    assert "UPSTREAM_LLM_ERROR" in body


async def _mock_query_cancelled(messages):
    yield "partial "
    raise asyncio.CancelledError()


def test_chat_does_not_log_error_on_client_cancellation(client, caplog, mocker):
    tc, _ = client
    from kb.api import chat as chat_module

    exception_spy = mocker.spy(chat_module.logger, "exception")

    with caplog.at_level(logging.ERROR, logger="kb.api.chat"):
        with patch("kb.api.chat.QueryAgent") as MockAgent:
            MockAgent.return_value.query = _mock_query_cancelled
            with tc.stream("POST", "/api/chat", json={"messages": [
                {"role": "user", "content": "hi"}
            ]}) as resp:
                body = b"".join(resp.iter_bytes()).decode("utf-8")

    # Endpoint must not log CancelledError as an error via logger.exception.
    assert exception_spy.call_count == 0
    # And must not log the generic "chat.stream_failed" line.
    assert not any("chat.stream_failed" in r.message for r in caplog.records)
    # And must not yield the generic "Stream failed" error-event payload.
    assert "Stream failed" not in body
