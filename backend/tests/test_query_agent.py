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
async def test_query_streams_answer(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\n"
        "# Deploy Process\n\nRun `make deploy` to ship.\n",
    )
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy the app.\n")

    # First call: page selection (non-streaming)
    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"

    # Second call: answer streaming
    stream_mock = _make_streaming_mock(["Run ", "`make deploy`", " to ship."])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query([{"role": "user", "content": "How do I deploy?"}]):
            tokens.append(token)

    answer = "".join(tokens)
    assert len(tokens) > 0
    assert isinstance(answer, str)


@pytest.mark.asyncio
async def test_query_returns_citations(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\n"
        "# Deploy Process\n\nRun `make deploy`.\n",
    )
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["The answer.", "__CITATIONS__:deploy-process"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query([{"role": "user", "content": "How do I deploy?"}]):
            tokens.append(token)

    assert any("deploy-process" in t for t in tokens)


async def test_query_agent_wraps_litellm_errors(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    agent = QueryAgent(fs=fs, model="test-model")

    with patch("kb.agents.query.litellm.acompletion", side_effect=RuntimeError("boom")):
        with pytest.raises(LLMUpstreamError):
            async for _ in agent.query([{"role": "user", "content": "hello?"}]):
                pass


@pytest.mark.asyncio
async def test_query_takes_messages_list(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\n"
        "Run make deploy.\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for t in agent.query([
            {"role": "user", "content": "How do I deploy?"},
            {"role": "assistant", "content": "Run make deploy."},
            {"role": "user", "content": "Tell me more."},
        ]):
            tokens.append(t)

    # Phase 2 call (second call) should include the full conversation as chat turns
    phase2_kwargs = mock_llm.call_args_list[1].kwargs
    roles = [m["role"] for m in phase2_kwargs["messages"]]
    # system + the 3 chat turns
    assert roles[0] == "system"
    assert roles[1:] == ["user", "assistant", "user"]


@pytest.mark.asyncio
async def test_phase1_uses_last_n_turns(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nx\n",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    long_history = []
    for i in range(10):
        role = "user" if i % 2 == 0 else "assistant"
        long_history.append({"role": role, "content": f"q{i}" if role == "user" else f"a{i}"})
    # Ensure last turn is user
    long_history.append({"role": "user", "content": "latest"})

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query(long_history):
            pass

    phase1_prompt = mock_llm.call_args_list[0].kwargs["messages"][0]["content"]
    # Only the tail should appear
    assert "latest" in phase1_prompt
    # Earlier turns should be absent
    assert "q0" not in phase1_prompt


@pytest.mark.asyncio
async def test_phase2_pages_are_line_numbered(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\n"
        "Line one\nLine two\nLine three",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "1: Line one" in phase2_system
    assert "2: Line two" in phase2_system
    assert "3: Line three" in phase2_system


@pytest.mark.asyncio
async def test_phase2_prompt_requests_ranged_citations(knowledge_dir, schema_dir):
    fs = WikiFS(knowledge_dir, schema_dir)
    fs.write_page(
        "deploy-process",
        "---\nslug: deploy-process\ntitle: Deploy Process\n---\nx",
    )
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "__CITATIONS__:" in phase2_system
    assert "slug:line_start-line_end" in phase2_system or "slug-one:15-22" in phase2_system
