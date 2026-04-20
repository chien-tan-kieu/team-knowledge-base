from typing import AsyncIterator
import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)

SELECT_HISTORY_TURNS = 3

SELECT_PROMPT = """You are a knowledge base search assistant.

Given the index below and the recent conversation, return ONLY the slugs of the most relevant wiki pages (comma-separated, max 5). No explanation.

INDEX:
{index}

RECENT CONVERSATION:
{history}

Respond with slugs only, e.g.: deploy-process, database-migrations"""


ANSWER_SYSTEM_PROMPT = """You are a helpful knowledge base assistant. Answer using ONLY the wiki pages provided below.

The pages are line-numbered. Use the line numbers to cite precisely.

WIKI PAGES:
{pages}

When you finish your answer, on its own final line, append:
__CITATIONS__:slug-one:15-22,slug-two:30-45

Each entry is `slug:line_start-line_end` (inclusive, 1-indexed). Use a single line number like `:30` for one line. Cite ranges that directly back a claim in your answer. Prefer tight ranges (3-15 lines). Never invent line numbers — if you can't locate a supporting passage, omit that source.

Example:
__CITATIONS__:deploy-process:15-22,ci-cd:30"""


def _format_history(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m["role"].upper()
        lines.append(f"{role}: {m['content']}")
    return "\n".join(lines)


def _format_page_with_line_numbers(slug: str, content: str) -> str:
    lines = content.split("\n")
    numbered = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))
    return f"\n--- {slug} ---\n{numbered}\n"


class QueryAgent:
    def __init__(self, fs: WikiFS, model: str) -> None:
        self._fs = fs
        self._model = model

    async def query(self, messages: list[dict]) -> AsyncIterator[str]:
        index = self._fs.read_index()
        recent = messages[-SELECT_HISTORY_TURNS:]

        # Phase 1: select relevant pages
        try:
            select_response = await litellm.acompletion(
                model=self._model,
                messages=[{
                    "role": "user",
                    "content": SELECT_PROMPT.format(index=index, history=_format_history(recent)),
                }],
            )
        except Exception as exc:
            logger.error("llm.select_failed")
            raise LLMUpstreamError() from exc

        slugs_raw = select_response.choices[0].message.content.strip()
        slugs = [s.strip() for s in slugs_raw.split(",") if s.strip()]

        # Phase 2: read selected pages (body + title only)
        pages_content = ""
        for slug in slugs:
            try:
                page = self._fs.read_page(slug)
                pages_content += _format_page_with_line_numbers(slug, page.body)
            except FileNotFoundError:
                continue
            except ValueError as exc:
                logger.warning(
                    "wiki.page_malformed", extra={"slug": slug, "error": str(exc)}
                )
                continue

        if not pages_content:
            yield "I couldn't find relevant information in the knowledge base."
            return

        system_message = {
            "role": "system",
            "content": ANSWER_SYSTEM_PROMPT.format(pages=pages_content),
        }
        chat_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

        # Phase 3: stream the answer
        try:
            stream = await litellm.acompletion(
                model=self._model,
                messages=[system_message, *chat_messages],
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    yield token
        except LLMUpstreamError:
            raise
        except Exception as exc:
            logger.error("llm.answer_failed")
            raise LLMUpstreamError() from exc
