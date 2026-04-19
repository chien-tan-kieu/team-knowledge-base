from datetime import date
from pydantic import BaseModel, Field


class WikiPageOutput(BaseModel):
    slug: str = Field(
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Lowercase, hyphen-separated. No file extension, no path separators.",
    )
    title: str = Field(min_length=1)
    related: list[str] = Field(
        description="Slugs of related pages. Empty list if none.",
    )
    summary: str = Field(min_length=1, description="One paragraph summary.")
    details: str = Field(
        min_length=1,
        description=(
            "Full content for this concept. Must preserve all source detail "
            "for the concept this page covers. Markdown allowed."
        ),
    )


class CompileOutput(BaseModel):
    pages: list[WikiPageOutput] = Field(
        min_length=1,
        description=(
            "One entry per distinct concept extracted from the raw document. "
            "Split aggressively — every concept, process, entity, comparison, or "
            "framework is its own page."
        ),
    )


def render_page_md(page: WikiPageOutput, source_filename: str, today: date) -> str:
    related_str = (
        ", ".join(f"[[{s}]]" for s in page.related) if page.related else "(none)"
    )
    return (
        f"# {page.title}\n\n"
        f"**Slug:** {page.slug}\n"
        f"**Related:** {related_str}\n"
        f"**Last updated:** {today.isoformat()}\n\n"
        f"## Summary\n\n{page.summary}\n\n"
        f"## Details\n\n{page.details}\n\n"
        f"## References\n\n"
        f"- Source: `raw/{source_filename}`\n"
    )


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


def render_log_entry(filename: str, slugs: list[str], today: date) -> str:
    return (
        f"## [{today.isoformat()}] ingest | {filename}\n"
        f"Pages touched: {', '.join(slugs)}"
    )
