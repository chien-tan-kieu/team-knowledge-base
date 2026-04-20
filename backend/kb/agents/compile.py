import logging
import re
from datetime import date

import litellm

from kb.agents.compile_schema import (
    CompileOutput,
    WikiPageOutput,
    render_index_md,
    render_log_entry,
    render_page_md,
)
from kb.errors import LLMUpstreamError
from kb.wiki.frontmatter import dump as dump_frontmatter
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)


COMPILE_PROMPT = """You compile a raw markdown document into structured wiki pages.

Produce one `WikiPageOutput` per distinct concept, entity, process, comparison, or framework found in the raw document. Split aggressively.

Each page has:
- slug: lowercase, hyphen-separated, matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
- title: human-readable.
- summary: one paragraph synopsis (used as the index bullet).
- related: slugs of cross-linked pages; empty list if none.
- body: free-form Markdown, at least 200 characters. Include whatever subheadings, lists, tables, and code blocks fit the concept.

Your output will be validated before it is written:
1. Every page body must be at least 200 characters.
2. Every fenced code block and every Markdown table present in the raw document must appear verbatim inside the body of at least one page.
3. The total length of all summaries and bodies combined must be at least {min_coverage:.0%} of the raw document length.

Rephrase prose where it helps clarity, but preserve numeric facts, named entities, code blocks, and tables verbatim. Do not invent information that is not in the raw document.

EXISTING PAGES (slug — summary), for slug consistency and cross-linking only:
{existing_index}

RAW DOCUMENT (filename: {filename}):
{raw_content}
"""


INDEX_BULLET_RE = re.compile(r"^\s*-\s+\[\[([a-z0-9-]+)\]\]\s*—\s*(.*)$")
FENCED_CODE_RE = re.compile(r"```[^\n]*\n.*?\n```", re.DOTALL)
TABLE_RE = re.compile(
    r"(?:^\|[^\n]+\|\n)+^\|\s*:?-{3,}.*\|\n(?:^\|[^\n]+\|\n?)+",
    re.MULTILINE,
)

PROPOSED_BLOCK_PREFIX = "## Proposed updates (from "


def _parse_index(index_md: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in index_md.splitlines():
        m = INDEX_BULLET_RE.match(line)
        if m:
            out[m.group(1)] = m.group(2).strip()
    return out


def _extract_required_blocks(raw: str) -> list[str]:
    return FENCED_CODE_RE.findall(raw) + TABLE_RE.findall(raw)


def _merge_unique(existing: list[str], new: list[str]) -> list[str]:
    seen = set()
    merged: list[str] = []
    for item in [*existing, *new]:
        if item not in seen:
            seen.add(item)
            merged.append(item)
    return merged


def _strip_proposed_block(body: str, raw_filename: str) -> str:
    header = f"{PROPOSED_BLOCK_PREFIX}{raw_filename})"
    idx = body.find(header)
    if idx == -1:
        return body
    # Find the next heading at any level (## through ######) after this block.
    after = body[idx + len(header):]
    match = re.search(r"\n#{1,6} ", after)
    if match is None:
        # No later heading — cut to end.
        trimmed = body[:idx]
    else:
        remainder_start = idx + len(header) + match.start()
        trimmed = body[:idx] + body[remainder_start + 1:]
    return trimmed.rstrip() + "\n"


class CompileAgent:
    def __init__(
        self,
        fs: WikiFS,
        model: str,
        min_coverage: float = 0.7,
    ) -> None:
        self._fs = fs
        self._model = model
        self._min_coverage = min_coverage

    async def compile(self, filename: str, raw_content: str) -> None:
        existing_summaries = _parse_index(self._fs.read_index())
        existing_index = (
            "\n".join(
                f"- {slug} — {summary}"
                for slug, summary in sorted(existing_summaries.items())
            )
            or "(none yet)"
        )

        prompt = COMPILE_PROMPT.format(
            existing_index=existing_index,
            filename=filename,
            raw_content=raw_content,
            min_coverage=self._min_coverage,
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
            raise LLMUpstreamError(
                "LLM request failed (network or upstream)."
            ) from exc

        raw_output = response.choices[0].message.content
        try:
            output = CompileOutput.model_validate_json(raw_output)
        except Exception as exc:
            logger.error("compile.schema_validation_failed")
            raise LLMUpstreamError(
                "LLM output did not match the expected schema."
            ) from exc

        self._assert_verbatim(output, raw_content)
        self._assert_coverage(output, raw_content)
        self._write(output, filename, existing_summaries)

    def _assert_verbatim(self, output: CompileOutput, raw_content: str) -> None:
        required = _extract_required_blocks(raw_content)
        if not required:
            return
        combined = "\n\n".join(p.body for p in output.pages)
        missing = [block for block in required if block not in combined]
        if missing:
            logger.error(
                "compile.verbatim_missing", extra={"missing_count": len(missing)}
            )
            raise LLMUpstreamError(
                "LLM output dropped a code block or table from the source."
            )

    def _assert_coverage(self, output: CompileOutput, raw_content: str) -> None:
        content_chars = sum(len(p.body) + len(p.summary) for p in output.pages)
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
        created: list[str] = []
        updated: list[str] = []
        proposed: list[str] = []

        for page in output.pages:
            branch = self._write_one(page, filename, today)
            {
                "created": created,
                "updated": updated,
                "proposed": proposed,
            }[branch].append(page.slug)

        merged_summaries = {
            **existing_summaries,
            **{p.slug: p.summary for p in output.pages if p.slug not in proposed},
        }
        # For proposed-only pages, keep whatever summary was already in the index
        # (human's summary wins). If none was indexed, fall back to the new summary.
        for p in output.pages:
            if p.slug in proposed and p.slug not in merged_summaries:
                merged_summaries[p.slug] = p.summary

        self._fs.write_index(render_index_md(merged_summaries))
        self._fs.append_log(
            render_log_entry(filename, created, updated, proposed, today)
        )

    def _write_one(
        self, page: WikiPageOutput, filename: str, today: date
    ) -> str:
        try:
            existing = self._fs.read_page(page.slug)
        except FileNotFoundError:
            existing = None
        except ValueError as exc:
            raise LLMUpstreamError(
                f"Existing wiki page '{page.slug}' has missing or invalid frontmatter; "
                f"run the migration step (see SCHEMA.md) to remove old-format pages."
            ) from exc

        if existing is None:
            self._fs.write_page(
                page.slug,
                render_page_md(
                    page, sources=[filename], updated=today, edited_by="llm"
                ),
            )
            return "created"

        existing_fm = existing.frontmatter
        if existing_fm.get("edited_by") == "human":
            return self._append_proposed(existing, page, filename, today)

        existing_sources = [str(s) for s in existing_fm.get("sources", [])]
        merged_sources = _merge_unique(existing_sources, [filename])
        self._fs.write_page(
            page.slug,
            render_page_md(
                page, sources=merged_sources, updated=today, edited_by="llm"
            ),
        )
        return "updated"

    def _append_proposed(
        self,
        existing,
        page: WikiPageOutput,
        filename: str,
        today: date,
    ) -> str:
        fm = dict(existing.frontmatter)
        fm["sources"] = _merge_unique(
            [str(s) for s in fm.get("sources", [])], [filename]
        )
        fm["updated"] = today
        # edited_by stays "human"; summary/title stay as the human left them.

        cleaned_body = _strip_proposed_block(existing.body, filename)
        new_block = (
            f"\n## Proposed updates (from {filename})\n\n"
            f"{page.body}\n"
        )
        new_body = cleaned_body.rstrip() + "\n" + new_block

        content = dump_frontmatter(fm, new_body)
        self._fs.write_page(page.slug, content)
        return "proposed"
