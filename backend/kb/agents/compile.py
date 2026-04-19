import logging
import re
from datetime import date

import litellm

from kb.agents.compile_schema import (
    CompileOutput,
    render_index_md,
    render_log_entry,
    render_page_md,
)
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)


COMPILE_PROMPT = """You compile a raw markdown document into structured wiki pages.

Produce one `WikiPageOutput` per distinct concept, entity, process, comparison, or framework found in the raw document. Split aggressively — do not fold multiple concepts into one page.

DO NOT summarize. Every fact, section, code example, table, and list in the raw document must appear in the `details` field of some page. Prefer preserving source wording. If the source is long, emit more pages, not shorter pages.

Slug rules: lowercase, hyphen-separated, no extension, no path. Must match `^[a-z0-9]+(-[a-z0-9]+)*$`.

Use the `related` field to cross-link pages you emit together (and to existing pages if the raw document relates to them).

EXISTING PAGES (slug — summary), for slug consistency and cross-linking only:
{existing_index}

RAW DOCUMENT (filename: {filename}):
{raw_content}
"""


INDEX_BULLET_RE = re.compile(r"^\s*-\s+\[\[([a-z0-9-]+)\]\]\s*—\s*(.*)$")


def _parse_index(index_md: str) -> dict[str, str]:
    """Extract slug → summary mapping from the wiki index bullet list."""
    out: dict[str, str] = {}
    for line in index_md.splitlines():
        m = INDEX_BULLET_RE.match(line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


class CompileAgent:
    def __init__(
        self,
        fs: WikiFS,
        model: str,
        min_coverage: float = 0.2,
    ) -> None:
        self._fs = fs
        self._model = model
        self._min_coverage = min_coverage

    async def compile(self, filename: str, raw_content: str) -> None:
        existing_summaries = _parse_index(self._fs.read_index())
        existing_index = (
            "\n".join(f"- {slug} — {summary}" for slug, summary in sorted(existing_summaries.items()))
            or "(none yet)"
        )

        prompt = COMPILE_PROMPT.format(
            existing_index=existing_index,
            filename=filename,
            raw_content=raw_content,
        )

        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
                response_format={
                    "type": "json_schema",
                    "json_schema": {
                        "name": "compile_output",
                        "strict": True,
                        "schema": CompileOutput.model_json_schema(),
                    },
                },
            )
        except Exception as exc:
            logger.error("llm.compile_failed")
            raise LLMUpstreamError("LLM request failed (network or upstream).") from exc

        raw_output = response.choices[0].message.content
        try:
            output = CompileOutput.model_validate_json(raw_output)
        except Exception as exc:
            logger.error("compile.schema_validation_failed")
            raise LLMUpstreamError(
                "LLM output did not match the expected schema."
            ) from exc

        self._assert_coverage(output, raw_content)
        self._write(output, filename, existing_summaries)

    def _assert_coverage(self, output: CompileOutput, raw_content: str) -> None:
        content_chars = sum(len(p.details) + len(p.summary) for p in output.pages)
        raw_chars = len(raw_content)
        if raw_chars == 0:
            return
        ratio = content_chars / raw_chars
        if ratio < self._min_coverage:
            logger.error(
                "compile.coverage_too_low",
                extra={"ratio": ratio, "threshold": self._min_coverage},
            )
            raise LLMUpstreamError(
                f"LLM output covered {ratio:.1%} of source "
                f"(< {self._min_coverage:.0%} required); model likely over-summarized."
            )

    def _write(
        self,
        output: CompileOutput,
        filename: str,
        existing_summaries: dict[str, str],
    ) -> None:
        today = date.today()

        for page in output.pages:
            self._fs.write_page(page.slug, render_page_md(page, filename, today))

        merged = {**existing_summaries, **{p.slug: p.summary for p in output.pages}}
        self._fs.write_index(render_index_md(merged))

        slugs = [p.slug for p in output.pages]
        self._fs.append_log(render_log_entry(filename, slugs, today))
