# Wiki Schema Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign wiki page template (YAML frontmatter + dense free-form body), rework the `CompileAgent` pipeline to preserve source fidelity and human edits, and adapt `QueryAgent` to read only page bodies.

**Architecture:** Move every page to `---\n<yaml>\n---\n# title\n<body>`. Drop the fixed `Summary / Details / References` sections; all metadata lives in frontmatter (`slug`, `title`, `summary`, `related`, `sources`, `updated`, `edited_by`). `CompileAgent` writes with three branches (fresh slug, `edited_by: llm` overwrite, `edited_by: human` → append a `## Proposed updates (from <raw>)` block). Three stacked fidelity checks prevent thin output: Pydantic `body ≥ 200`, verbatim code/table substring match, coverage floor `0.7`.

**Tech Stack:** Python 3.13, Pydantic v2, PyYAML (new), LiteLLM 1.83, pytest.

**Spec:** `docs/superpowers/specs/2026-04-20-wiki-schema-redesign-design.md` (commit `73c5310`).

---

## File Structure

| File | Kind | Responsibility |
|---|---|---|
| `backend/pyproject.toml` | modify | Add PyYAML dep. |
| `backend/kb/wiki/frontmatter.py` | create | YAML frontmatter parse/dump helpers. |
| `backend/tests/test_frontmatter.py` | create | Round-trip + malformed-input tests. |
| `backend/kb/config.py` | modify | Raise `compile_min_coverage` default to `0.7`. |
| `backend/.env.example` | modify | Match new default. |
| `backend/kb/wiki/models.py` | modify | Extend `WikiPage` with `frontmatter: dict` and `body: str`. |
| `backend/kb/wiki/fs.py` | modify | `read_page` parses frontmatter into the extended `WikiPage`. |
| `backend/kb/agents/compile_schema.py` | rewrite | `WikiPageOutput.body` field, new renderers. |
| `backend/tests/test_compile_schema.py` | rewrite | Tests against new schema and renderers. |
| `backend/kb/agents/compile.py` | rewrite | Pipeline branching, verbatim check, new prompt. |
| `backend/tests/test_compile_agent.py` | rewrite | Tests for the new pipeline. |
| `backend/kb/agents/query.py` | modify | Inline body only; render title from frontmatter. |
| `backend/knowledge/schema/SCHEMA.md` | rewrite | Document the new template, fidelity rules, edit-survival convention. |
| `backend/knowledge/wiki/pages/*.md` (except `.gitkeep`) | delete | Old test data. |
| `backend/knowledge/wiki/index.md` | reset | Empty shell to be regenerated on next ingest. |
| `backend/knowledge/wiki/log.md` | reset | Empty shell. |

---

## Task 1: Add PyYAML + frontmatter helper module

**Files:**
- Modify: `backend/pyproject.toml`
- Create: `backend/kb/wiki/frontmatter.py`
- Create: `backend/tests/test_frontmatter.py`

- [ ] **Step 1.1 — Add PyYAML to backend dependencies.**

In `backend/pyproject.toml`, add `"pyyaml>=6.0"` to the `dependencies` list:

```toml
dependencies = [
    "fastapi==0.128.0",
    "uvicorn[standard]>=0.34",
    "python-multipart>=0.0.20",
    "sse-starlette>=2.3",
    "litellm==1.83.3",
    "pydantic-settings>=2.9",
    "PyJWT>=2.8",
    "pyyaml>=6.0",
]
```

Run from `backend/`:

```bash
uv sync --extra dev
```

Expected: `pyyaml` and `types-PyYAML` (if auto-selected by uv) install without error.

- [ ] **Step 1.2 — Write the failing frontmatter tests.**

Create `backend/tests/test_frontmatter.py`:

```python
import pytest

from kb.wiki.frontmatter import dump, parse


def test_parse_extracts_frontmatter_and_body():
    md = (
        "---\n"
        "slug: foo\n"
        "title: Foo\n"
        "related: []\n"
        "---\n"
        "# Foo\n\nBody content.\n"
    )
    fm, body = parse(md)
    assert fm == {"slug": "foo", "title": "Foo", "related": []}
    assert body == "# Foo\n\nBody content.\n"


def test_parse_rejects_missing_frontmatter():
    with pytest.raises(ValueError, match="frontmatter"):
        parse("# Foo\nno frontmatter here\n")


def test_parse_rejects_unclosed_frontmatter():
    with pytest.raises(ValueError, match="frontmatter"):
        parse("---\nslug: foo\n# body without close\n")


def test_parse_rejects_invalid_yaml():
    with pytest.raises(ValueError, match="YAML"):
        parse("---\nslug: [unclosed\n---\nbody\n")


def test_dump_round_trips_parse():
    fm = {"slug": "foo", "title": "Foo", "related": ["bar"]}
    body = "# Foo\n\nBody.\n"
    text = dump(fm, body)
    fm2, body2 = parse(text)
    assert fm2 == fm
    assert body2 == body


def test_dump_produces_block_style_yaml():
    # Block style (not flow style) is easier to diff by humans.
    text = dump({"slug": "foo", "related": ["a", "b"]}, "body\n")
    assert "related:\n- a\n- b\n" in text
```

- [ ] **Step 1.3 — Run the tests to confirm they fail.**

From `backend/`:

```bash
.venv/bin/pytest tests/test_frontmatter.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.wiki.frontmatter'`.

- [ ] **Step 1.4 — Implement the helper.**

Create `backend/kb/wiki/frontmatter.py`:

```python
import yaml

_DELIM = "---"


def parse(text: str) -> tuple[dict, str]:
    lines = text.split("\n")
    if not lines or lines[0].strip() != _DELIM:
        raise ValueError("Missing opening '---' frontmatter delimiter")
    for i in range(1, len(lines)):
        if lines[i].strip() == _DELIM:
            yaml_block = "\n".join(lines[1:i])
            body = "\n".join(lines[i + 1 :])
            try:
                fm = yaml.safe_load(yaml_block) or {}
            except yaml.YAMLError as exc:
                raise ValueError(f"Invalid YAML frontmatter: {exc}") from exc
            if not isinstance(fm, dict):
                raise ValueError("Frontmatter must be a YAML mapping")
            return fm, body
    raise ValueError("Missing closing '---' frontmatter delimiter")


def dump(frontmatter: dict, body: str) -> str:
    yaml_block = yaml.safe_dump(
        frontmatter,
        sort_keys=False,
        default_flow_style=False,
        allow_unicode=True,
    )
    return f"{_DELIM}\n{yaml_block}{_DELIM}\n{body}"
```

- [ ] **Step 1.5 — Run the tests to confirm they pass.**

```bash
.venv/bin/pytest tests/test_frontmatter.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 1.6 — Commit.**

```bash
git add backend/pyproject.toml backend/kb/wiki/frontmatter.py backend/tests/test_frontmatter.py backend/uv.lock 2>/dev/null || git add backend/pyproject.toml backend/kb/wiki/frontmatter.py backend/tests/test_frontmatter.py
git commit -m "feat(wiki): add YAML frontmatter parse/dump helper

Standalone module used by the upcoming compile/query changes.
No callers yet."
```

---

## Task 2: Raise compile coverage default to 0.7

**Files:**
- Modify: `backend/kb/config.py`
- Modify: `backend/.env.example`

- [ ] **Step 2.1 — Update the default and the comment in `config.py`.**

In `backend/kb/config.py`, change the `compile_min_coverage` block:

```python
    # Minimum ratio of compile output chars (summary + body) to raw input chars.
    # Below this we assume the LLM over-summarized and fail the ingest.
    compile_min_coverage: float = 0.7
```

- [ ] **Step 2.2 — Update `.env.example` to match.**

In `backend/.env.example`, change the commented default:

```
# Reject ingest if compile output covers < this ratio of the raw document (fights over-summarization).
COMPILE_MIN_COVERAGE=0.7
```

- [ ] **Step 2.3 — Verify existing tests still pass.**

From `backend/`:

```bash
.venv/bin/pytest tests/test_compile_agent.py -v
```

Expected: all tests PASS (they pass `min_coverage` explicitly, so default change does not affect them).

- [ ] **Step 2.4 — Commit.**

```bash
git add backend/kb/config.py backend/.env.example
git commit -m "chore(config): raise COMPILE_MIN_COVERAGE default 0.2 -> 0.7"
```

---

## Task 3: Extend `WikiPage` and `WikiFS.read_page` to expose frontmatter + body

**Files:**
- Modify: `backend/kb/wiki/models.py`
- Modify: `backend/kb/wiki/fs.py`
- Create: `backend/tests/test_wiki_fs.py` (if not present; otherwise add cases)

**Rationale:** Keep the existing `content` field so existing callers (`QueryAgent`) do not break before Task 6. Add `frontmatter: dict` and `body: str` so new callers (`CompileAgent` in Task 5) can use the parsed view.

- [ ] **Step 3.1 — Write the failing read_page test.**

Create `backend/tests/test_wiki_fs.py` if it does not exist, or append these tests to it:

```python
import pytest

from kb.wiki.fs import WikiFS


def test_read_page_parses_frontmatter_and_body(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    (knowledge_dir / "wiki" / "pages" / "foo.md").write_text(
        "---\n"
        "slug: foo\n"
        "title: Foo\n"
        "---\n"
        "# Foo\n\nBody.\n",
        encoding="utf-8",
    )

    page = fs.read_page("foo")

    assert page.slug == "foo"
    assert page.frontmatter == {"slug": "foo", "title": "Foo"}
    assert page.body == "# Foo\n\nBody.\n"
    # Backwards-compat: full file still accessible.
    assert page.content.startswith("---\n")


def test_read_page_raises_on_missing_frontmatter(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    (knowledge_dir / "wiki" / "pages" / "bar.md").write_text(
        "# Bar\n\nNo frontmatter.\n", encoding="utf-8"
    )

    with pytest.raises(ValueError, match="frontmatter"):
        fs.read_page("bar")
```

(The `knowledge_dir` fixture exists in `backend/tests/conftest.py`.)

- [ ] **Step 3.2 — Run the tests to confirm they fail.**

```bash
.venv/bin/pytest tests/test_wiki_fs.py -v
```

Expected: FAIL — `WikiPage` has no `frontmatter` or `body` attribute.

- [ ] **Step 3.3 — Extend `WikiPage`.**

In `backend/kb/wiki/models.py`, change `WikiPage`:

```python
class WikiPage(BaseModel):
    slug: str
    content: str
    frontmatter: dict
    body: str
```

- [ ] **Step 3.4 — Update `WikiFS.read_page` to populate the new fields.**

In `backend/kb/wiki/fs.py`, replace `read_page`:

```python
from kb.wiki.frontmatter import parse as parse_frontmatter


class WikiFS:
    # ... existing code ...

    def read_page(self, slug: str) -> WikiPage:
        path = self._pages / f"{slug}.md"
        if not path.exists():
            raise FileNotFoundError(f"Wiki page not found: {slug}")
        content = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(content)
        return WikiPage(slug=slug, content=content, frontmatter=frontmatter, body=body)
```

Place the `from kb.wiki.frontmatter import parse as parse_frontmatter` import at the top of the file alongside the other imports.

- [ ] **Step 3.5 — Run the new tests and the rest of the suite.**

```bash
.venv/bin/pytest tests/test_wiki_fs.py -v
.venv/bin/pytest -v
```

Expected (first command): the two new tests PASS.
Expected (full suite): Everything PASSES *except* any test that writes a page without YAML frontmatter via `fs.write_page(...)` and then calls `fs.read_page(...)`. None exist today; `test_compile_agent.py` calls `read_page` only on content the compile pipeline produced. If a failure surfaces, it is either in this plan (Task 5 rewrites those tests) or a real regression — in that case, fix before proceeding.

- [ ] **Step 3.6 — Commit.**

```bash
git add backend/kb/wiki/models.py backend/kb/wiki/fs.py backend/tests/test_wiki_fs.py
git commit -m "feat(wiki): parse frontmatter on read_page

WikiPage now exposes frontmatter (dict) and body (str) alongside
the raw content string. No callers switched yet."
```

---

## Task 4: Rewrite compile schema and renderers

**Files:**
- Rewrite: `backend/kb/agents/compile_schema.py`
- Rewrite: `backend/tests/test_compile_schema.py`

**Rationale:** `WikiPageOutput` becomes `{slug, title, summary, related, body}` with `body: min_length=200`. `render_page_md` emits YAML frontmatter + `# title` + body. `render_log_entry` takes three lists (`created`, `updated`, `proposed`) and omits empty categories. `render_index_md` is unchanged except the input dict now comes from frontmatter `summary`.

- [ ] **Step 4.1 — Write the failing schema + renderer tests.**

Replace the entire contents of `backend/tests/test_compile_schema.py` with:

```python
from datetime import date

import pytest
from pydantic import ValidationError

from kb.agents.compile_schema import (
    CompileOutput,
    WikiPageOutput,
    render_index_md,
    render_log_entry,
    render_page_md,
)
from kb.wiki.frontmatter import parse as parse_frontmatter


def _valid_page_kwargs(**overrides):
    base = {
        "slug": "foo-bar",
        "title": "Foo Bar",
        "summary": "A one-paragraph summary.",
        "related": [],
        "body": "x" * 250,
    }
    base.update(overrides)
    return base


def test_slug_accepts_hyphenated_lowercase():
    WikiPageOutput(**_valid_page_kwargs(slug="claude-code-cli"))
    WikiPageOutput(**_valid_page_kwargs(slug="a1"))


@pytest.mark.parametrize(
    "bad_slug",
    ["Foo", "foo.md", "foo_bar", "foo/bar", "-foo", "foo-", "", "foo--bar"],
)
def test_slug_rejects_invalid(bad_slug):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(slug=bad_slug))


def test_body_min_length_200():
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(body="short"))


def test_compile_output_requires_at_least_one_page():
    with pytest.raises(ValidationError):
        CompileOutput(pages=[])


def test_render_page_md_produces_frontmatter_plus_body():
    page = WikiPageOutput(**_valid_page_kwargs(related=["other-slug"]))
    md = render_page_md(
        page,
        sources=["source.md"],
        updated=date(2026, 4, 20),
        edited_by="llm",
    )
    fm, body = parse_frontmatter(md)
    assert fm == {
        "slug": "foo-bar",
        "title": "Foo Bar",
        "summary": "A one-paragraph summary.",
        "related": ["other-slug"],
        "sources": ["source.md"],
        "updated": date(2026, 4, 20),
        "edited_by": "llm",
    }
    assert body.startswith("# Foo Bar\n")
    assert ("x" * 250) in body


def test_render_page_md_empty_related():
    page = WikiPageOutput(**_valid_page_kwargs(related=[]))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    fm, _ = parse_frontmatter(md)
    assert fm["related"] == []


def test_render_index_md_sorts_slugs():
    md = render_index_md({"zebra": "last one", "apple": "first one"})
    assert md.index("[[apple]]") < md.index("[[zebra]]")
    assert "first one" in md
    assert "last one" in md


def test_render_log_entry_three_categories():
    entry = render_log_entry(
        "doc.md",
        created=["a"],
        updated=["b"],
        proposed=["c"],
        today=date(2026, 4, 20),
    )
    assert entry.startswith("## [2026-04-20] ingest | doc.md\n")
    assert "Created: a" in entry
    assert "Updated: b" in entry
    assert "Proposed updates queued: c" in entry


def test_render_log_entry_omits_empty_categories():
    entry = render_log_entry(
        "doc.md", created=["a", "b"], updated=[], proposed=[], today=date(2026, 4, 20)
    )
    assert "Created: a, b" in entry
    assert "Updated:" not in entry
    assert "Proposed updates queued:" not in entry
```

- [ ] **Step 4.2 — Run the schema tests to confirm they fail.**

```bash
.venv/bin/pytest tests/test_compile_schema.py -v
```

Expected: multiple failures — `WikiPageOutput` has no `body` field yet, `render_page_md` has old signature, `render_log_entry` has old signature.

- [ ] **Step 4.3 — Rewrite `compile_schema.py`.**

Replace the entire contents of `backend/kb/agents/compile_schema.py` with:

```python
from datetime import date

from pydantic import BaseModel, Field

from kb.wiki.frontmatter import dump as dump_frontmatter


class WikiPageOutput(BaseModel):
    slug: str = Field(
        pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$",
        description="Lowercase, hyphen-separated. No extension, no path separators.",
    )
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1, description="One paragraph, used by the index.")
    related: list[str] = Field(description="Slugs of related pages. Empty list if none.")
    body: str = Field(
        min_length=200,
        description=(
            "Free-form Markdown. Must preserve every fact, code block, and table "
            "from the portion of the source this page covers. Subheadings are "
            "allowed; no required sub-sections."
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
    body = f"# {page.title}\n\n{page.body}\n"
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
```

- [ ] **Step 4.4 — Run the schema tests to confirm they pass.**

```bash
.venv/bin/pytest tests/test_compile_schema.py -v
```

Expected: all tests PASS.

- [ ] **Step 4.5 — Run the full suite; note expected failures.**

```bash
.venv/bin/pytest -v
```

Expected: `tests/test_compile_agent.py` fails because `CompileAgent` still references the old schema (`summary`, `details`, old `render_page_md` signature, old `render_log_entry` signature). Those tests are rewritten in Task 5. Any other failures are regressions and must be fixed before proceeding.

- [ ] **Step 4.6 — Commit.**

```bash
git add backend/kb/agents/compile_schema.py backend/tests/test_compile_schema.py
git commit -m "feat(compile): frontmatter-based page schema and renderers

WikiPageOutput carries {summary, related, body >=200}; render_page_md
emits YAML frontmatter + title + body. render_log_entry now takes
created/updated/proposed lists.

CompileAgent still references the old schema and is rewritten in the
next commit."
```

---

## Task 5: Rewrite `CompileAgent` pipeline + prompt + tests

**Files:**
- Rewrite: `backend/kb/agents/compile.py`
- Rewrite: `backend/tests/test_compile_agent.py`

**Rationale:** This is the core behavior change — the three-branch write path (fresh / `llm` / `human`), verbatim fidelity check, updated prompt. After this task, the full test suite passes again.

- [ ] **Step 5.1 — Write the failing CompileAgent tests.**

Replace the entire contents of `backend/tests/test_compile_agent.py` with:

```python
import json
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from kb.agents.compile import CompileAgent
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
    # Payload omits the code block from every body.
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
async def test_compile_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = CompileAgent(fs=fs, model="test-model")
    with patch(
        "kb.agents.compile.litellm.acompletion", side_effect=RuntimeError("boom")
    ):
        with pytest.raises(LLMUpstreamError):
            await agent.compile("file.md", "raw")
```

- [ ] **Step 5.2 — Run the new tests to confirm they fail.**

```bash
.venv/bin/pytest tests/test_compile_agent.py -v
```

Expected: FAIL — `CompileAgent` still uses the old schema fields.

- [ ] **Step 5.3 — Rewrite `compile.py`.**

Replace the entire contents of `backend/kb/agents/compile.py` with:

```python
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
    # Find the next "## " heading after this block (same or higher level).
    remainder_start = body.find("\n## ", idx + len(header))
    if remainder_start == -1:
        # No later heading — cut to end.
        trimmed = body[:idx]
    else:
        trimmed = body[:idx] + body[remainder_start + 1 :]
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
```

- [ ] **Step 5.4 — Run all tests.**

```bash
.venv/bin/pytest -v
```

Expected: the full suite (including `test_compile_agent.py`, `test_compile_schema.py`, `test_frontmatter.py`, `test_wiki_fs.py`) PASSES.

If any tests fail on regex edge cases (e.g., `TABLE_RE` not matching a specific raw), iterate the regex until the new tests pass — but do not relax a check to paper over a real bug.

- [ ] **Step 5.5 — Commit.**

```bash
git add backend/kb/agents/compile.py backend/tests/test_compile_agent.py
git commit -m "feat(compile): branching pipeline, verbatim check, new prompt

- Fresh slug -> new page with edited_by=llm.
- Existing llm page -> overwrite, merge sources dedup.
- Existing human page -> append ## Proposed updates (from <raw>) block;
  replace any prior block for the same raw.
- Reject output that drops code blocks / tables from the source.
- Prompt rewritten to enumerate validation checks and preserve
  verbatim code/tables."
```

---

## Task 6: `QueryAgent` reads body only

**Files:**
- Modify: `backend/kb/agents/query.py`
- Modify: `backend/tests/` — add a new focused test if none exists

**Rationale:** The YAML frontmatter would be noise in the answer prompt. Feed the LLM the body only, with the title as a header line.

- [ ] **Step 6.1 — Check for existing query-agent tests.**

```bash
.venv/bin/pytest tests/ -v -k query
ls backend/tests/ | grep -i query
```

If `tests/test_query_agent.py` exists, read it and extend it. Otherwise skip to Step 6.2 — the functional check in Step 6.4 is sufficient gating.

- [ ] **Step 6.2 — Update `QueryAgent` formatting.**

In `backend/kb/agents/query.py`, replace the Phase 2 loop that builds `pages_content`:

```python
        # Phase 2: read selected pages (body + title only)
        pages_content = ""
        for slug in slugs:
            try:
                page = self._fs.read_page(slug)
            except (FileNotFoundError, ValueError):
                continue
            title = page.frontmatter.get("title", slug)
            pages_content += f"\n--- {slug}: {title} ---\n{page.body}\n"
```

Rationale for the `ValueError` catch: a malformed page (missing frontmatter) should not take down the whole query — skip it the same way a missing page is skipped.

- [ ] **Step 6.3 — Run the existing test suite.**

```bash
.venv/bin/pytest -v
```

Expected: all tests still pass.

- [ ] **Step 6.4 — Smoke-test end-to-end by inspection.**

From the repo root:

```bash
pnpm dev:backend &
# Wait a few seconds, then in another shell:
curl -s -X POST http://localhost:8000/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"test"}]}' | head -20
# Ctrl-C the backend when done.
```

Expected: no tracebacks related to `WikiPage.content` vs `WikiPage.body` — pages load and the stream begins (even if it returns "I couldn't find relevant information" because `wiki/pages/` is empty at this point in the plan). If a traceback mentions frontmatter parsing on a page file that still has the old template, that file should be deleted in Task 8 and the check re-run then.

- [ ] **Step 6.5 — Commit.**

```bash
git add backend/kb/agents/query.py
git commit -m "feat(query): inline page body + title only, drop frontmatter from prompt"
```

---

## Task 7: Rewrite `SCHEMA.md`

**Files:**
- Rewrite: `backend/knowledge/schema/SCHEMA.md`

- [ ] **Step 7.1 — Replace `SCHEMA.md` with the new documentation.**

Replace the entire contents of `backend/knowledge/schema/SCHEMA.md` with:

```markdown
# Wiki Schema

The authoritative schema for compile output lives in code: `backend/kb/agents/compile_schema.py`. The `CompileAgent` asks the LLM for a `CompileOutput` via LiteLLM's `response_format` JSON-Schema mode, validates the output, then renders the Markdown for every page, the index, and the log entry in code.

## Page Format (rendered in code)

Every wiki page in `wiki/pages/` has YAML frontmatter followed by a free-form Markdown body:

```markdown
---
slug: <slug>
title: <Page Title>
summary: One-paragraph synopsis used by the index.
related: [other-slug, another-slug]
sources: [raw-filename-1.md, raw-filename-2.md]
updated: YYYY-MM-DD
edited_by: llm
---

# <Page Title>

<Body. Free-form Markdown. Whatever subheadings the concept needs.
Tables, code blocks, block quotes from the source appear verbatim.
No required sub-sections.>
```

Frontmatter fields:

- `slug` — lowercase, hyphen-separated. Regex `^[a-z0-9]+(-[a-z0-9]+)*$`. Matches the filename stem.
- `title` — human-readable. Rendered as the body's first `#` heading.
- `summary` — single paragraph, used verbatim as the index bullet.
- `related` — list of other slugs. Empty list if none.
- `sources` — list of raw filenames inside `knowledge/raw/`. Grows on re-ingest.
- `updated` — ISO date (`YYYY-MM-DD`). Advances on every compiler write.
- `edited_by` — `llm` or `human`. Write-protect flag.

## Human Edits

A page is the human's when its frontmatter says `edited_by: human`. Humans set this flag manually when they save an edit — there is no file watcher. The `CompileAgent` treats any `edited_by: human` page as write-protected:

- The existing frontmatter and body are preserved.
- New compiled content is appended inside a `## Proposed updates (from <raw_filename>)` block.
- Re-ingesting the same raw replaces only the matching block; older blocks from other raws stay intact.
- Humans accept a proposal by copying content from the block into the main body and deleting the block.

## Body Rules

- At least 200 characters. This is enforced by the `WikiPageOutput.body` schema.
- Every fenced code block and Markdown table in the raw source must appear verbatim in the body of some page. The compiler rejects output that drops them.
- Prose may be rephrased; numeric facts, named entities, code blocks, and tables are verbatim.

## Coverage Floor

`sum(len(summary) + len(body))` across all pages ≥ `COMPILE_MIN_COVERAGE` × `len(raw_content)`. Default `0.7`. Configurable via the `COMPILE_MIN_COVERAGE` env var.

## Index Format (rendered in code)

`wiki/index.md` is fully regenerated on every ingest from the union of existing index entries and new page summaries:

```
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

- [[slug-name]] — Summary string from frontmatter
```

Slugs are sorted alphabetically. The bullet text is the `summary` frontmatter field of the current page (or the prior index entry if the page was not touched by this ingest).

## Log Format (rendered in code)

Each ingest appends an entry. Empty categories are omitted:

```
## [YYYY-MM-DD] ingest | <filename>
Created: slug-a, slug-b
Updated: slug-c
Proposed updates queued: slug-d
```

## Naming Conventions

- One page per distinct concept, entity, or process. The compile prompt instructs the LLM to split aggressively.
- Backlinks use `[[slug]]` syntax inside Markdown prose.
- A page's body should be substantial (≥ 200 chars, typically more); split long content into sub-pages rather than writing one huge page.

## Migration Note

The prior template (`# Title` + `**Slug:** / **Related:** / **Last updated:**` header block + `## Summary / ## Details / ## References`) is obsolete. Pages from that era must be regenerated: delete `wiki/pages/*.md`, `wiki/index.md`, and `wiki/log.md`, then re-ingest the relevant `raw/` files.
```

- [ ] **Step 7.2 — Commit.**

```bash
git add backend/knowledge/schema/SCHEMA.md
git commit -m "docs(schema): rewrite SCHEMA.md for frontmatter + dense-body template"
```

---

## Task 8: Migrate test wiki data

**Files:**
- Delete: `backend/knowledge/wiki/pages/*.md` (keep `.gitkeep`).
- Reset: `backend/knowledge/wiki/index.md`.
- Reset: `backend/knowledge/wiki/log.md`.

**Rationale:** The four existing pages were produced by the old template and will fail `parse_frontmatter`. They are test data; re-ingest regenerates them cleanly under the new pipeline.

- [ ] **Step 8.1 — Delete old page files (keep `.gitkeep`).**

```bash
cd backend/knowledge/wiki/pages
ls | grep -v '^\.gitkeep$' | xargs -I {} rm {}
ls -la
```

Expected: only `.gitkeep` remains.

- [ ] **Step 8.2 — Reset the index and log files.**

Overwrite `backend/knowledge/wiki/index.md` with:

```markdown
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

```

Overwrite `backend/knowledge/wiki/log.md` with a single line (the existing file likely has a header; keep it minimal):

```markdown
# Ingest Log
```

- [ ] **Step 8.3 — Re-ingest the existing raw document.**

Start the backend and POST the sample raw file:

```bash
cd backend
.venv/bin/uvicorn kb.main:app --port 8000 &
BACKEND_PID=$!
sleep 2
curl -s -X POST http://localhost:8000/api/ingest \
  -F "file=@knowledge/raw/claude-modes-research.md"
# Poll the returned job_id until status=done (or read logs).
kill $BACKEND_PID
```

Expected: ingest job completes; `backend/knowledge/wiki/pages/` is repopulated with one or more pages that each start with `---\n` (YAML frontmatter) and whose bodies are ≥ 200 chars; `wiki/index.md` and `wiki/log.md` have entries.

If the ingest fails with a fidelity error (`coverage too low`, `dropped a code block`), inspect the raw document — for test data with no code blocks/tables it should only be coverage. If coverage legitimately cannot be reached on the test document, lower `COMPILE_MIN_COVERAGE` in `backend/.env` *locally* for the test run (do not commit a lowered default).

- [ ] **Step 8.4 — Inspect one regenerated page by hand.**

```bash
cat backend/knowledge/wiki/pages/*.md | head -60
```

Expected: frontmatter block present, `edited_by: llm`, body is dense and contains source material.

- [ ] **Step 8.5 — Commit only the reset scaffolding; do not commit generated test pages.**

Generated pages in `wiki/pages/*.md` are gitignored per `backend/.gitignore`, and the regenerated `index.md` / `log.md` are uncommitted working changes the developer can keep locally. Only commit the explicit resets if `index.md` / `log.md` are tracked in git.

```bash
git status
# If index.md or log.md appear as modified, and their content is the reset scaffolding:
git add backend/knowledge/wiki/index.md backend/knowledge/wiki/log.md
git commit -m "chore(wiki): reset test index/log; old pages obsolete under new schema"
```

If the repo gitignores them or they are unchanged, skip the commit.

---

## Self-Review

The following spec requirements are each covered by a task above:

| Spec requirement | Covered by |
|---|---|
| YAML frontmatter + free-form body template | Task 4 (renderer) + Task 7 (docs) |
| Frontmatter fields (`slug`, `title`, `summary`, `related`, `sources`, `updated`, `edited_by`) | Task 4 |
| `WikiPageOutput.body` with `min_length=200` | Task 4 |
| Drop `Summary`/`Details`/`References` sections | Task 4 |
| Frontmatter parser/dumper | Task 1 |
| `WikiFS.read_page` returns frontmatter + body | Task 3 |
| PyYAML dependency | Task 1 |
| Pipeline branching (fresh / `llm` / `human`) | Task 5 |
| `sources` list dedup-merge | Task 5 |
| `## Proposed updates (from <raw>)` append + single-block-per-raw replace | Task 5 |
| Verbatim code-block / table preservation check | Task 5 |
| Coverage floor raised to `0.7` | Task 2 |
| Prompt update | Task 5 |
| `QueryAgent` body-only inlining with title | Task 6 |
| Index driven by frontmatter `summary` | Task 5 (merging logic) + Task 4 (renderer unchanged) |
| Three-category log entry | Task 4 (renderer) + Task 5 (collector) |
| Distinct error messages for fidelity checks | Task 5 |
| `SCHEMA.md` rewrite | Task 7 |
| Migration (delete + re-ingest) | Task 8 |
| `.env.example` updated | Task 2 |

No open placeholders. Type names (`WikiPageOutput`, `render_page_md`, `render_log_entry`, `dump_frontmatter`, `parse_frontmatter`) are consistent across tasks.
