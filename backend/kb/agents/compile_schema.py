from datetime import date
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from kb.wiki.frontmatter import dump as dump_frontmatter


SlugStr = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$"),
]


class WikiPageOutput(BaseModel):
    slug: str = Field(
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Lowercase, hyphen-separated. No extension, no path separators.",
    )
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1, description="One paragraph, used by the index.")
    related: list[SlugStr] = Field(
        description="Slugs of related pages. Empty list if none."
    )
    body: str = Field(
        min_length=200,
        description=(
            "Free-form Markdown. Subheadings, lists, tables, and code blocks allowed; "
            "no required sub-sections. Fenced code blocks and Markdown tables from "
            "the source portion this page covers must appear verbatim (enforced "
            "post-validation by CompileAgent, not by this schema)."
        ),
    )


class CompileOutput(BaseModel):
    pages: list[WikiPageOutput] = Field(
        min_length=1,
        description=(
            "One entry per distinct concept extracted from the raw document. "
            "Split aggressively."
        ),
    )


def _strip_leading_title(body: str, title: str) -> str:
    stripped = body.lstrip()
    for prefix in ("# ", "## "):
        candidate = f"{prefix}{title}"
        if stripped.startswith(candidate):
            rest = stripped[len(candidate):]
            if rest == "" or rest[0] == "\n":
                return rest.lstrip("\n")
    return body


def render_page_md(
    page: WikiPageOutput,
    sources: list[str],
    updated: date,
    edited_by: str = "llm",
) -> str:
    frontmatter = {
        "slug": page.slug,
        "title": page.title,
        "summary": page.summary,
        "related": list(page.related),
        "sources": list(sources),
        "updated": updated,
        "edited_by": edited_by,
    }
    body_content = _strip_leading_title(page.body, page.title)
    body = f"# {page.title}\n\n{body_content}\n"
    return dump_frontmatter(frontmatter, body)


def render_index_md(slug_to_summary: dict[str, str]) -> str:
    bullets = "\n".join(
        f"- [[{slug}]] — {summary.splitlines()[0] if summary else ''}"
        for slug, summary in sorted(slug_to_summary.items())
    )
    return (
        "# Knowledge Base Index\n\n"
        "This file is maintained by the CompileAgent. Do not edit manually.\n\n"
        "## Pages\n\n"
        f"{bullets}\n"
    )


def render_log_entry(
    filename: str,
    created: list[str],
    updated: list[str],
    proposed: list[str],
    today: date,
) -> str:
    lines = [f"## [{today.isoformat()}] ingest | {filename}"]
    if created:
        lines.append(f"Created: {', '.join(created)}")
    if updated:
        lines.append(f"Updated: {', '.join(updated)}")
    if proposed:
        lines.append(f"Proposed updates queued: {', '.join(proposed)}")
    return "\n".join(lines)
