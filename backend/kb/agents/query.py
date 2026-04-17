from typing import AsyncIterator
import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)


SELECT_PROMPT = """You are a knowledge base search assistant.

Given the index below and a user question, return ONLY the slugs of the most relevant wiki pages (comma-separated, max 5). No explanation.

INDEX:
{index}

QUESTION: {question}

Respond with slugs only, e.g.: deploy-process, database-migrations"""


ANSWER_PROMPT = """You are a helpful knowledge base assistant. Answer the question using ONLY the wiki pages provided.

WIKI PAGES:
{pages}

QUESTION: {question}

Answer clearly and concisely. At the very end of your response, on its own line, append:
__CITATIONS__:slug-one,slug-two
listing all slugs you drew from."""


class QueryAgent:
    def __init__(self, fs: WikiFS, model: str) -> None:
        self._fs = fs
        self._model = model

    async def query(self, question: str) -> AsyncIterator[str]:
        index = self._fs.read_index()

        # Step 1: select relevant pages (non-streaming, fast)
        try:
            select_response = await litellm.acompletion(
                model=self._model,
                messages=[{"role": "user", "content": SELECT_PROMPT.format(index=index, question=question)}],
            )
        except Exception as exc:
            logger.exception("llm.select_failed")
            raise LLMUpstreamError() from exc

        slugs_raw = select_response.choices[0].message.content.strip()
        slugs = [s.strip() for s in slugs_raw.split(",") if s.strip()]

        # Step 2: read selected pages
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

        # Step 3: stream the answer
        try:
            stream = await litellm.acompletion(
                model=self._model,
                messages=[{"role": "user", "content": ANSWER_PROMPT.format(pages=pages_content, question=question)}],
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    yield token
        except LLMUpstreamError:
            raise
        except Exception as exc:
            logger.exception("llm.answer_failed")
            raise LLMUpstreamError() from exc
