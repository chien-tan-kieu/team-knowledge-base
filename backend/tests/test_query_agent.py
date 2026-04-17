import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.query import QueryAgent
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS


def _make_streaming_mock(tokens: list[str]):
    """Build a mock async iterator that yields SSE-style chunks."""
    async def _aiter(self=None):
        for token in tokens:
            chunk = MagicMock()
            chunk.choices[0].delta.content = token
            yield chunk

    mock = AsyncMock()
    mock.__aiter__ = _aiter
    return mock


@pytest.mark.asyncio
async def test_query_streams_answer(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy` to ship.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy the app.\n")

    # First call: page selection (non-streaming)
    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"

    # Second call: answer streaming
    stream_mock = _make_streaming_mock(["Run ", "`make deploy`", " to ship."])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query("How do I deploy?"):
            tokens.append(token)

    answer = "".join(tokens)
    assert len(tokens) > 0
    assert isinstance(answer, str)


@pytest.mark.asyncio
async def test_query_returns_citations(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy`.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["The answer.", "__CITATIONS__:deploy-process"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query("How do I deploy?"):
            tokens.append(token)

    assert any("deploy-process" in t for t in tokens)


async def test_query_agent_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = QueryAgent(fs=fs, model="test-model")

    with patch("kb.agents.query.litellm.acompletion", side_effect=RuntimeError("boom")):
        with pytest.raises(LLMUpstreamError):
            async for _ in agent.query("hello?"):
                pass
