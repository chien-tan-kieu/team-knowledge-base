import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.compile import CompileAgent
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS


def _mock_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.choices[0].message.content = json.dumps(payload)
    return response


ONBOARDING_PAYLOAD = {
    "pages": [
        {
            "slug": "onboarding-guide",
            "title": "Onboarding Guide",
            "related": [],
            "summary": "Step-by-step guide for new engineers joining the team.",
            "details": "Clone the repo. Install dependencies. Run the bootstrap script. "
            "Verify the dev server runs. Pair with a buddy for the first week.",
        }
    ]
}


@pytest.mark.asyncio
async def test_compile_creates_wiki_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 10)

    page = fs.read_page("onboarding-guide")
    assert "# Onboarding Guide" in page.content
    assert "**Slug:** onboarding-guide" in page.content
    assert "## Summary" in page.content
    assert "## Details" in page.content
    assert "## References" in page.content
    assert "raw/onboarding.md" in page.content


@pytest.mark.asyncio
async def test_compile_updates_index(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw")

    index = fs.read_index()
    assert "[[onboarding-guide]]" in index
    assert "Step-by-step guide for new engineers" in index


@pytest.mark.asyncio
async def test_compile_appends_log(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw")

    log = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "ingest | onboarding.md" in log
    assert "onboarding-guide" in log


@pytest.mark.asyncio
async def test_compile_preserves_existing_index_entries(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    # Pre-seed the index with a prior page's entry.
    fs.write_index(
        "# Knowledge Base Index\n\n## Pages\n\n- [[earlier-page]] — A page from a previous ingest.\n"
    )

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw")

    index = fs.read_index()
    assert "[[earlier-page]]" in index
    assert "[[onboarding-guide]]" in index


@pytest.mark.asyncio
async def test_compile_rejects_invalid_slug(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    bad = {
        "pages": [
            {
                "slug": "Foo.md",
                "title": "Foo",
                "related": [],
                "summary": "x",
                "details": "y",
            }
        ]
    }

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(bad)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("f.md", "raw")


@pytest.mark.asyncio
async def test_compile_rejects_low_coverage(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        # Raw is much larger than summary+details → ratio below threshold.
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.9)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("onboarding.md", "x" * 100_000)


async def test_compile_agent_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = CompileAgent(fs=fs, model="test-model")

    with patch("kb.agents.compile.litellm.acompletion", side_effect=RuntimeError("boom")):
        with pytest.raises(LLMUpstreamError):
            await agent.compile("file.md", "raw")
