import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.compile import CompileAgent
from kb.wiki.fs import WikiFS


MOCK_AGENT_OUTPUT = """=== PAGE: onboarding-guide ===
# Onboarding Guide

**Slug:** onboarding-guide
**Related:**
**Last updated:** 2026-04-16

## Summary

Step-by-step guide for new engineers joining the team.

## Details

Follow these steps to get set up.

=== INDEX ===
# Knowledge Base Index

## Pages

- [[onboarding-guide]] — Step-by-step guide for new engineers joining the team.

=== LOG_ENTRY ===
## [2026-04-16] ingest | Onboarding Guide
Pages touched: onboarding-guide
"""


@pytest.mark.asyncio
async def test_compile_creates_wiki_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1: clone the repo.")

    page = fs.read_page("onboarding-guide")
    assert "Onboarding Guide" in page.content


@pytest.mark.asyncio
async def test_compile_updates_index(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1: clone the repo.")

    index = fs.read_index()
    assert "onboarding-guide" in index


@pytest.mark.asyncio
async def test_compile_appends_log(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1.")

    log = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "ingest" in log
