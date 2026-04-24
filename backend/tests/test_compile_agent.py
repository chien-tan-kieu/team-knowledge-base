import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kb.agents.compile import CompileAgent, _structured_output_kwargs
from kb.errors import LLMUpstreamError
from kb.wiki.frontmatter import dump as dump_frontmatter, parse as parse_frontmatter
from kb.wiki.fs import WikiFS


BODY_250 = "x" * 250
BODY_400 = "y" * 400


def _mock_response(payload: dict) -> MagicMock:
    response = MagicMock()
    response.choices[0].message.content = json.dumps(payload)
    return response


ONBOARDING_PAYLOAD = {
    "pages": [
        {
            "slug": "onboarding-guide",
            "title": "Onboarding Guide",
            "summary": "Step-by-step guide for new engineers joining the team.",
            "related": [],
            "body": BODY_250,
        }
    ]
}


def _page_path(knowledge_dir, slug):
    return knowledge_dir / "wiki" / "pages" / f"{slug}.md"


@pytest.mark.asyncio
async def test_compile_creates_wiki_page_with_frontmatter(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    text = _page_path(knowledge_dir, "onboarding-guide").read_text()
    fm, body = parse_frontmatter(text)
    assert fm["slug"] == "onboarding-guide"
    assert fm["sources"] == ["onboarding.md"]
    assert fm["edited_by"] == "llm"
    assert body.startswith("# Onboarding Guide\n")
    assert BODY_250 in body


@pytest.mark.asyncio
async def test_compile_updates_index_from_summary(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    index = fs.read_index()
    assert "[[onboarding-guide]]" in index
    assert "Step-by-step guide" in index


@pytest.mark.asyncio
async def test_compile_log_lists_created(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    log = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "ingest | onboarding.md" in log
    assert "Created: onboarding-guide" in log


@pytest.mark.asyncio
async def test_compile_overwrites_llm_page_and_merges_sources(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    # Seed an existing llm page whose frontmatter includes a prior source.
    prior = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Onboarding Guide",
            "summary": "Old summary.",
            "related": [],
            "sources": ["older.md"],
            "updated": date(2026, 4, 1),
            "edited_by": "llm",
        },
        f"# Onboarding Guide\n\n{BODY_250}\n",
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(prior, encoding="utf-8")

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    fm, body = parse_frontmatter(
        _page_path(knowledge_dir, "onboarding-guide").read_text()
    )
    assert fm["sources"] == ["older.md", "onboarding.md"]
    assert fm["edited_by"] == "llm"
    assert "Step-by-step guide" in fm["summary"]
    assert BODY_250 in body
    assert "## Proposed updates" not in body


@pytest.mark.asyncio
async def test_compile_overwrites_llm_page_and_merges_related(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    prior = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Onboarding Guide",
            "summary": "Old summary.",
            "related": ["legacy-link"],
            "sources": ["older.md"],
            "updated": date(2026, 4, 1),
            "edited_by": "llm",
        },
        f"# Onboarding Guide\n\n{BODY_250}\n",
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(prior, encoding="utf-8")

    payload = {
        "pages": [
            {
                "slug": "onboarding-guide",
                "title": "Onboarding Guide",
                "summary": "New summary.",
                "related": ["new-link"],  # LLM emits a different cross-link
                "body": BODY_250,
            }
        ]
    }
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(payload)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    fm, _ = parse_frontmatter(
        _page_path(knowledge_dir, "onboarding-guide").read_text()
    )
    # Both prior and new cross-links survive, dedup, prior-first order.
    assert fm["related"] == ["legacy-link", "new-link"]


@pytest.mark.asyncio
async def test_compile_appends_proposed_updates_on_human_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    human_page = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Human Curated Onboarding",
            "summary": "Curated by a human.",
            "related": [],
            "sources": ["older.md"],
            "updated": date(2026, 4, 1),
            "edited_by": "human",
        },
        "# Human Curated Onboarding\n\nHand-written content.\n",
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(
        human_page, encoding="utf-8"
    )

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    text = _page_path(knowledge_dir, "onboarding-guide").read_text()
    fm, body = parse_frontmatter(text)

    # Frontmatter survives (summary stays human's), sources grow, edited_by stays human.
    assert fm["summary"] == "Curated by a human."
    assert fm["edited_by"] == "human"
    assert fm["sources"] == ["older.md", "onboarding.md"]

    # Body retains human content and gets one proposed-updates block.
    assert "Hand-written content." in body
    assert body.count("## Proposed updates (from onboarding.md)") == 1
    assert BODY_250 in body

    # Log records it under "Proposed updates queued".
    log = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "Proposed updates queued: onboarding-guide" in log


@pytest.mark.asyncio
async def test_compile_replaces_prior_proposed_block_for_same_raw(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    first_body = (
        "# Human Curated\n\nHand-written.\n\n"
        "## Proposed updates (from onboarding.md)\n\n"
        "Old proposal body.\n"
    )
    human_page = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Human Curated",
            "summary": "Curated.",
            "related": [],
            "sources": ["onboarding.md"],
            "updated": date(2026, 4, 5),
            "edited_by": "human",
        },
        first_body,
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(
        human_page, encoding="utf-8"
    )

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    _, body = parse_frontmatter(
        _page_path(knowledge_dir, "onboarding-guide").read_text()
    )
    assert body.count("## Proposed updates (from onboarding.md)") == 1
    assert "Old proposal body." not in body
    assert BODY_250 in body


@pytest.mark.asyncio
async def test_compile_proposed_block_preserves_following_subheading(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    body_with_following = (
        "# Human Curated\n\nHand-written.\n\n"
        "## Proposed updates (from onboarding.md)\n\n"
        "Old proposal body.\n\n"
        "## Personal notes\n\n"
        "I want to keep this section.\n"
    )
    human_page = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Human Curated",
            "summary": "Curated.",
            "related": [],
            "sources": ["onboarding.md"],
            "updated": date(2026, 4, 5),
            "edited_by": "human",
        },
        body_with_following,
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(
        human_page, encoding="utf-8"
    )

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    _, body = parse_frontmatter(
        _page_path(knowledge_dir, "onboarding-guide").read_text()
    )
    assert "## Personal notes" in body
    assert "I want to keep this section." in body
    assert body.count("## Proposed updates (from onboarding.md)") == 1
    assert BODY_250 in body


@pytest.mark.asyncio
async def test_compile_strips_stale_proposed_block_with_internal_subheading(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    body_with_internal_h3 = (
        "# Human Curated\n\nHand-written.\n\n"
        "## Proposed updates (from onboarding.md)\n\n"
        "Old proposal preamble.\n\n"
        "### Examples\n\n"
        "Old example one.\n\n"
        "### Notes\n\n"
        "Old notes.\n"
    )
    human_page = dump_frontmatter(
        {
            "slug": "onboarding-guide",
            "title": "Human Curated",
            "summary": "Curated.",
            "related": [],
            "sources": ["onboarding.md"],
            "updated": date(2026, 4, 5),
            "edited_by": "human",
        },
        body_with_internal_h3,
    )
    _page_path(knowledge_dir, "onboarding-guide").write_text(
        human_page, encoding="utf-8"
    )

    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("onboarding.md", "raw " * 100)

    _, body = parse_frontmatter(
        _page_path(knowledge_dir, "onboarding-guide").read_text()
    )
    # Stale internal subheadings must be gone — no leaks.
    assert "Old proposal preamble." not in body
    assert "Old example one." not in body
    assert "Old notes." not in body
    assert "### Examples" not in body
    assert "### Notes" not in body
    # The new proposed block is present.
    assert body.count("## Proposed updates (from onboarding.md)") == 1
    assert BODY_250 in body


@pytest.mark.asyncio
async def test_compile_rejects_invalid_slug(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    bad = {
        "pages": [
            {
                "slug": "Foo.md",
                "title": "Foo",
                "summary": "x",
                "related": [],
                "body": BODY_250,
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(bad))
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("f.md", "raw")


@pytest.mark.asyncio
async def test_compile_rejects_existing_page_without_frontmatter(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    _page_path(knowledge_dir, "onboarding-guide").write_text(
        "# Old format\n\nNo frontmatter at all.\n",
        encoding="utf-8",
    )
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError, match="frontmatter"):
            await agent.compile("onboarding.md", "raw " * 100)


@pytest.mark.asyncio
async def test_compile_rejects_short_body(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    short = {
        "pages": [
            {
                "slug": "x",
                "title": "X",
                "summary": "s",
                "related": [],
                "body": "too short",
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(short))
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
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.9)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("onboarding.md", "x" * 100_000)


@pytest.mark.asyncio
async def test_compile_rejects_missing_code_block(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    raw = (
        "Here is a critical code block.\n\n"
        "```python\ndef hello():\n    return 1\n```\n\n"
        "More prose.\n"
    )
    payload = {
        "pages": [
            {
                "slug": "hello",
                "title": "Hello",
                "summary": "Greets.",
                "related": [],
                "body": "A" * 400,
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(payload))
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError, match="code block|table"):
            await agent.compile("hello.md", raw)


@pytest.mark.asyncio
async def test_compile_accepts_when_code_block_preserved(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    code_block = "```python\ndef hello():\n    return 1\n```"
    raw = f"Intro.\n\n{code_block}\n\nOutro.\n"
    payload = {
        "pages": [
            {
                "slug": "hello",
                "title": "Hello",
                "summary": "Greets.",
                "related": [],
                "body": f"A preamble. {code_block}\n\nMore body. " + ("z" * 300),
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(payload))
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("hello.md", raw)


@pytest.mark.asyncio
async def test_compile_rejects_missing_table(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    raw = (
        "Here is a critical table.\n\n"
        "| col-a | col-b |\n"
        "| --- | --- |\n"
        "| one | two |\n"
        "| three | four |\n\n"
        "More prose.\n"
    )
    payload = {
        "pages": [
            {
                "slug": "tabular",
                "title": "Tabular",
                "summary": "Has a table.",
                "related": [],
                "body": "A" * 400,
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(payload))
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError, match="code block|table"):
            await agent.compile("tabular.md", raw)


@pytest.mark.asyncio
async def test_compile_accepts_when_table_preserved(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    table = (
        "| col-a | col-b |\n"
        "| --- | --- |\n"
        "| one | two |\n"
        "| three | four |\n"
    )
    raw = f"Intro.\n\n{table}\nOutro.\n"
    payload = {
        "pages": [
            {
                "slug": "tabular",
                "title": "Tabular",
                "summary": "Has a table.",
                "related": [],
                "body": f"A preamble.\n\n{table}\nMore body. " + ("z" * 300),
            }
        ]
    }
    with patch(
        "litellm.acompletion", new=AsyncMock(return_value=_mock_response(payload))
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        await agent.compile("tabular.md", raw)


@pytest.mark.asyncio
async def test_compile_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = CompileAgent(fs=fs, model="test-model")
    with patch(
        "kb.agents.compile.litellm.acompletion", side_effect=RuntimeError("boom")
    ):
        with pytest.raises(LLMUpstreamError):
            await agent.compile("file.md", "raw")


@pytest.mark.parametrize(
    "model",
    ["ollama/gemma3:4b", "ollama_chat/qwen2.5:7b", "ollama/llama3.2"],
)
def test_structured_output_kwargs_uses_format_extra_body_for_ollama(model):
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = _structured_output_kwargs(model, schema)
    assert kwargs == {"extra_body": {"format": schema}}


@pytest.mark.parametrize(
    "model",
    ["claude-sonnet-4-6", "claude-haiku-4-5-20251001", "gpt-4o-mini", "gemini/gemini-2.0-flash"],
)
def test_structured_output_kwargs_uses_response_format_for_frontier(model):
    schema = {"type": "object", "properties": {"x": {"type": "string"}}}
    kwargs = _structured_output_kwargs(model, schema)
    assert kwargs == {
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "compile_output",
                "strict": True,
                "schema": schema,
            },
        }
    }


@pytest.mark.asyncio
async def test_compile_passes_format_extra_body_for_ollama_model(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    mock_completion = AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD))
    with patch("litellm.acompletion", new=mock_completion):
        agent = CompileAgent(
            fs=fs, model="ollama_chat/gemma3:4b", min_coverage=0.0
        )
        await agent.compile("onboarding.md", "raw " * 100)

    call_kwargs = mock_completion.call_args.kwargs
    assert "response_format" not in call_kwargs
    assert "extra_body" in call_kwargs
    assert "format" in call_kwargs["extra_body"]
    # The schema is the Pydantic-generated one for CompileOutput.
    assert call_kwargs["extra_body"]["format"]["type"] == "object"


@pytest.mark.asyncio
async def test_compile_passes_response_format_for_frontier_model(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    mock_completion = AsyncMock(return_value=_mock_response(ONBOARDING_PAYLOAD))
    with patch("litellm.acompletion", new=mock_completion):
        agent = CompileAgent(
            fs=fs, model="claude-sonnet-4-6", min_coverage=0.0
        )
        await agent.compile("onboarding.md", "raw " * 100)

    call_kwargs = mock_completion.call_args.kwargs
    assert "extra_body" not in call_kwargs
    assert call_kwargs["response_format"]["type"] == "json_schema"
    assert call_kwargs["response_format"]["json_schema"]["strict"] is True


@pytest.mark.asyncio
async def test_compile_rejects_when_llm_returns_non_slug_related(knowledge_dir):
    bad_payload = {
        "pages": [
            {
                "slug": "onboarding-guide",
                "title": "Onboarding Guide",
                "summary": "Step-by-step guide for new engineers joining the team.",
                "related": ["/docs/anthropic/modes-chat"],
                "body": BODY_250,
            }
        ]
    }
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(bad_payload)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("onboarding.md", "raw " * 100)

    # Nothing should have been persisted.
    assert fs.list_pages() == []
