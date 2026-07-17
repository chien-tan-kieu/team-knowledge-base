from datetime import date
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from kb.wiki.frontmatter import dump as dump_frontmatter


SlugStr = Annotated[
    str,
    StringConstraints(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$"),
]

RESERVED_TOPICS = frozenset({"uncategorized", "pages"})


class WikiPageOutput(BaseModel):
    slug: str = Field(
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Lowercase, hyphen-separated. No extension, no path separators.",
    )
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1, description="One paragraph, used by the index.")
    topic: SlugStr = Field(
        description=(
            "Broad subject area this page belongs to, slug format "
            "(e.g. 'spec-tools'). Reuse an existing topic when the page fits one."
        ),
    )
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

    @field_validator("topic")
    @classmethod
    def _reject_reserved_topics(cls, value: str) -> str:
        if value in RESERVED_TOPICS:
            raise ValueError(f"topic '{value}' is reserved; choose another")
        return value


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
        "topic": page.topic,
        "related": list(page.related),
        "sources": list(sources),
        "updated": updated,
        "edited_by": edited_by,
    }
    body_content = _strip_leading_title(page.body, page.title)
    body = f"# {page.title}\n\n{body_content}\n"
    if page.related:
        links = "\n".join(f"- [[{slug}]]" for slug in page.related)
        body += f"\n## See also\n\n{links}\n"
    return dump_frontmatter(frontmatter, body)


def humanize_topic(topic: str) -> str:
    """'spec-tools' -> 'Spec Tools'. Lossless round trip for slug-format strings."""
    return " ".join(word.capitalize() for word in topic.split("-"))


def dehumanize_topic(heading: str) -> str:
    """'Spec Tools' -> 'spec-tools'. Inverse of humanize_topic."""
    return heading.strip().lower().replace(" ", "-")


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
