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


ANSWER_SYSTEM_PROMPT = """You are a helpful knowledge base assistant. Answer using ONLY the wiki pages provided.

WIKI PAGES:
{pages}

At the very end of your response, on its own final line, append:
__CITATIONS__:slug-one,slug-two
listing all slugs you drew from."""


def _format_history(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m["role"].upper()
        lines.append(f"{role}: {m['content']}")
    return "\n".join(lines)


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

        # Phase 2: read selected pages
        pages_content = ""
        for slug in slugs:
            try:
                page = self._fs.read_page(slug)
                pages_content += f"\n--- {slug} ---\n{page.content}\n"
            except FileNotFoundError:
                pass

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
