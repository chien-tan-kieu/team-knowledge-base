import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)


COMPILE_PROMPT = """You are a knowledge base compiler. You receive a raw markdown document and the current wiki state, and you produce structured wiki pages following the schema.

SCHEMA:
{schema}

CURRENT INDEX:
{index}

EXISTING PAGES (relevant ones):
{existing_pages}

RAW DOCUMENT TO COMPILE (filename: {filename}):
{raw_content}

Produce output in EXACTLY this format — no extra text before or after:

=== PAGE: slug-name ===
(full markdown content for this page, following the schema)

=== PAGE: another-slug ===
(content for another page if needed — include ALL pages that need creating or updating)

=== INDEX ===
(the complete updated index.md content)

=== LOG_ENTRY ===
## [YYYY-MM-DD] ingest | Document Title
Pages touched: slug-one, slug-two
"""


class CompileAgent:
    def __init__(self, fs: WikiFS, model: str, max_context_pages: int = 10) -> None:
        self._fs = fs
        self._model = model
        self._max_context_pages = max_context_pages

    async def compile(self, filename: str, raw_content: str) -> None:
        schema = self._fs.read_schema()
        index = self._fs.read_index()

        existing_pages = ""
        # Cap context to the most recent N pages so the prompt stays bounded as
        # the wiki grows. The full index is still included above.
        for slug in self._fs.list_pages()[-self._max_context_pages :]:
            page = self._fs.read_page(slug)
            existing_pages += f"\n--- {slug} ---\n{page.content}\n"

        prompt = COMPILE_PROMPT.format(
            schema=schema,
            index=index,
            existing_pages=existing_pages or "(none yet)",
            filename=filename,
            raw_content=raw_content,
        )

        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            logger.error("llm.compile_failed")
            raise LLMUpstreamError() from exc

        output = response.choices[0].message.content
        self._parse_and_write(output)

    def _parse_and_write(self, output: str) -> None:
        parts = output.split("===")
        i = 0
        while i < len(parts):
            part = parts[i].strip()
            if part.startswith("PAGE:"):
                slug = part.removeprefix("PAGE:").strip()
                content = parts[i + 1].strip() if i + 1 < len(parts) else ""
                self._fs.write_page(slug, content)
                i += 2
            elif part == "INDEX":
                content = parts[i + 1].strip() if i + 1 < len(parts) else ""
                self._fs.write_index(content)
                i += 2
            elif part == "LOG_ENTRY":
                content = parts[i + 1].strip() if i + 1 < len(parts) else ""
                self._fs.append_log(content)
                i += 2
            else:
                i += 1
