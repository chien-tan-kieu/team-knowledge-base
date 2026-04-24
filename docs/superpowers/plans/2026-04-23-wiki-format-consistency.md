# Wiki Format Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the wiki ingestion pipeline so compiled pages are consistently well-formed GFM markdown, and make the frontend render GFM tables.

**Architecture:** Three layers — (a) compile prompt adds output-format rules, (b) `CompileAgent` + schema add peer guardrails alongside existing verbatim/coverage checks, (c) `render_page_md` strips a repeated title and the frontend `WikiPageViewer` gains `remark-gfm`. Each fix is a small, isolated change that fails loudly at the gate rather than silently persisting broken pages.

**Tech Stack:** Python (FastAPI, pydantic, LiteLLM, pytest) for backend; React 19 + `react-markdown` + Vitest for frontend.

**Spec:** `docs/superpowers/specs/2026-04-23-wiki-format-consistency-design.md`

---

## Branch setup

Work on a dedicated branch off `main`. Suggested name: `feature/wiki-format-consistency`.

```bash
git checkout main
git pull
git checkout -b feature/wiki-format-consistency
```

**Commit policy:** Per `.claude/CLAUDE.md`, per-task `git commit` is part of this plan and is authorized by the user approving the plan. `git push`, `gh pr create`, and `gh pr merge` are NOT part of any task — do NOT run them without a separate explicit user request in the implementing session.

---

## Task 1: Frontend — render GFM tables via `remark-gfm`

**Files:**
- Modify: `frontend/package.json` (adds `remark-gfm` to `dependencies`)
- Modify: `frontend/src/components/WikiPageViewer.tsx`
- Modify: `frontend/src/components/__tests__/WikiPageViewer.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/components/__tests__/WikiPageViewer.test.tsx`, inside the existing `describe('WikiPageViewer', …)` block:

```tsx
  it('renders a GFM pipe table', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n'
    const { container } = render(<WikiPageViewer content={md} />)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    const cells = container.querySelectorAll('td')
    const texts = Array.from(cells).map((c) => c.textContent)
    expect(texts).toEqual(['1', '2'])
  })
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/WikiPageViewer.test.tsx`

Expected: the new test fails because `container.querySelector('table')` returns `null` (vanilla `react-markdown` does not render pipe tables).

- [ ] **Step 3: Install `remark-gfm`**

Run: `cd frontend && pnpm add remark-gfm`

This should add something like `"remark-gfm": "^4.x.x"` to the `dependencies` section of `frontend/package.json` and update `pnpm-lock.yaml`.

- [ ] **Step 4: Wire the plugin into `WikiPageViewer`**

Modify `frontend/src/components/WikiPageViewer.tsx`:

```tsx
import { createElement, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li' | 'pre' | 'blockquote' | 'table'

function withLines<T extends Tag>(tag: T) {
  return function Component(props: ComponentPropsWithoutRef<T> & ExtraProps) {
    const { node, ...rest } = props
    return createElement(tag, {
      ...rest,
      'data-source-line-start': node?.position?.start?.line,
      'data-source-line-end': node?.position?.end?.line,
    })
  }
}

const components = {
  p: withLines('p'),
  h1: withLines('h1'),
  h2: withLines('h2'),
  h3: withLines('h3'),
  h4: withLines('h4'),
  h5: withLines('h5'),
  h6: withLines('h6'),
  ul: withLines('ul'),
  ol: withLines('ol'),
  li: withLines('li'),
  pre: withLines('pre'),
  blockquote: withLines('blockquote'),
  table: withLines('table'),
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose-wiki">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/WikiPageViewer.test.tsx`

Expected: both `'attaches data-source-line-*'` and `'renders a GFM pipe table'` pass.

- [ ] **Step 6: Run full frontend verification**

Run: `cd frontend && pnpm lint && pnpm test`

Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml \
        frontend/src/components/WikiPageViewer.tsx \
        frontend/src/components/__tests__/WikiPageViewer.test.tsx
git commit -m "feat(frontend): render GFM tables in WikiPageViewer via remark-gfm"
```

---

## Task 2: Backend schema — per-item slug pattern on `related`

**Files:**
- Modify: `backend/kb/agents/compile_schema.py`
- Modify: `backend/tests/test_compile_schema.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_compile_schema.py`:

```python
def test_related_accepts_valid_slugs():
    WikiPageOutput(**_valid_page_kwargs(related=["other-slug", "a1"]))


@pytest.mark.parametrize(
    "bad_slug",
    ["/docs/foo", "Foo", "foo.md", "foo_bar", "foo/bar", "-foo", "foo-", "", "foo--bar"],
)
def test_related_rejects_non_slug(bad_slug):
    with pytest.raises(ValidationError):
        WikiPageOutput(**_valid_page_kwargs(related=[bad_slug]))
```

- [ ] **Step 2: Run the tests and confirm the new parametrized cases fail**

Run: `cd backend && .venv/bin/pytest tests/test_compile_schema.py -v`

Expected: `test_related_accepts_valid_slugs` passes; `test_related_rejects_non_slug[...]` cases fail because `related: list[str]` has no per-item pattern today.

- [ ] **Step 3: Add the constrained slug type and use it for `related`**

Modify `backend/kb/agents/compile_schema.py`:

```python
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
```

Leave `CompileOutput`, `render_page_md`, `render_index_md`, and `render_log_entry` untouched in this task.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && .venv/bin/pytest tests/test_compile_schema.py -v`

Expected: all tests in the file pass, including the new parametrized cases.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/compile_schema.py backend/tests/test_compile_schema.py
git commit -m "feat(compile): validate related slugs with per-item pattern constraint"
```

---

## Task 3: Backend — end-to-end rejection when LLM returns bad `related`

Task 2's schema change already makes `CompileAgent.compile()` reject bad `related` values via `CompileOutput.model_validate_json` (see `backend/kb/agents/compile.py:170-175`). This task only adds a regression test that asserts the end-to-end behavior and wiring.

**Files:**
- Modify: `backend/tests/test_compile_agent.py`

- [ ] **Step 1: Write the regression test**

Append to `backend/tests/test_compile_agent.py` (uses the existing `_mock_response`, `BODY_250`, `knowledge_dir` fixture, and imports):

```python
@pytest.mark.asyncio
async def test_compile_rejects_when_llm_returns_non_slug_related(knowledge_dir):
    bad_payload = {
        "pages": [
            {
                "slug": "onboarding-guide",
                "title": "Onboarding Guide",
                "summary": "Step-by-step guide for new engineers joining the team.",
                "related": ["/docs/anthropic/modes-chat"],
                "body": BODY_250,
            }
        ]
    }
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(bad_payload)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError):
            await agent.compile("onboarding.md", "raw " * 100)

    # Nothing should have been persisted.
    assert fs.list_pages() == []
```

- [ ] **Step 2: Run the test and confirm it passes**

Run: `cd backend && .venv/bin/pytest tests/test_compile_agent.py::test_compile_rejects_when_llm_returns_non_slug_related -v`

Expected: PASS (Task 2's schema update already enforces the constraint).

- [ ] **Step 3: Run the full compile-agent test suite**

Run: `cd backend && .venv/bin/pytest tests/test_compile_agent.py -v`

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_compile_agent.py
git commit -m "test(compile): regression test for bad related slug rejection"
```

---

## Task 4: Backend — block-HTML guardrail in `CompileAgent`

**Files:**
- Modify: `backend/kb/agents/compile.py`
- Modify: `backend/tests/test_compile_agent.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_compile_agent.py`:

```python
from kb.agents.compile import CompileAgent, BLOCK_HTML_RE


def test_block_html_re_matches_table_tag():
    assert BLOCK_HTML_RE.search("prose\n<table>\nstuff</table>")
    assert BLOCK_HTML_RE.search("<p>para</p>")
    assert BLOCK_HTML_RE.search("<TD>upper</TD>")


def test_block_html_re_allows_inline_tags():
    assert BLOCK_HTML_RE.search("one<br/>two") is None
    assert BLOCK_HTML_RE.search("x <sub>y</sub> z") is None
    assert BLOCK_HTML_RE.search("<details>hidden</details>") is None


@pytest.mark.asyncio
async def test_compile_rejects_when_llm_returns_block_html(knowledge_dir):
    html_body = (
        "Intro paragraph providing context so the body exceeds the two-hundred-character "
        "minimum imposed by the schema. This text is only here for padding and carries "
        "no meaningful content beyond that goal.\n\n"
        "<table><tr><td>a</td></tr></table>\n"
    )
    bad_payload = {
        "pages": [
            {
                "slug": "onboarding-guide",
                "title": "Onboarding Guide",
                "summary": "Step-by-step guide for new engineers joining the team.",
                "related": [],
                "body": html_body,
            }
        ]
    }
    fs = WikiFS(knowledge_dir)
    with patch(
        "litellm.acompletion",
        new=AsyncMock(return_value=_mock_response(bad_payload)),
    ):
        agent = CompileAgent(fs=fs, model="test", min_coverage=0.0)
        with pytest.raises(LLMUpstreamError, match="raw HTML block tags"):
            await agent.compile("onboarding.md", "raw " * 100)

    assert fs.list_pages() == []
```

Update the top-level import in `backend/tests/test_compile_agent.py` from

```python
from kb.agents.compile import CompileAgent, _structured_output_kwargs
```

to

```python
from kb.agents.compile import BLOCK_HTML_RE, CompileAgent, _structured_output_kwargs
```

(`_structured_output_kwargs` is used by existing tests at lines ~535 and ~547 — keep it.)

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && .venv/bin/pytest tests/test_compile_agent.py -v`

Expected: the three new tests fail because `BLOCK_HTML_RE` does not yet exist (import error) and `compile()` does not reject block HTML.

- [ ] **Step 3: Add `BLOCK_HTML_TAGS`, `BLOCK_HTML_RE`, `_assert_no_block_html`, and wire it in**

Modify `backend/kb/agents/compile.py`. Add the constants near the other module-level regexes (after `TABLE_RE`):

```python
BLOCK_HTML_TAGS = (
    "table", "p", "div", "td", "tr", "thead", "tbody", "th", "ul", "ol", "li",
)
BLOCK_HTML_RE = re.compile(
    r"<\s*(" + "|".join(BLOCK_HTML_TAGS) + r")\b[^>]*>",
    re.IGNORECASE,
)
```

Add the method inside `CompileAgent`, next to `_assert_verbatim` / `_assert_coverage`:

```python
    def _assert_no_block_html(self, output: CompileOutput) -> None:
        for page in output.pages:
            if BLOCK_HTML_RE.search(page.body):
                logger.error(
                    "compile.block_html_present", extra={"slug": page.slug}
                )
                raise LLMUpstreamError(
                    "LLM output contained raw HTML block tags; markdown expected."
                )
```

Wire it into `compile()`, between the verbatim and coverage checks:

```python
        if self._require_verbatim:
            self._assert_verbatim(output, raw_content)
        self._assert_no_block_html(output)
        self._assert_coverage(output, raw_content)
        self._write(output, filename, existing_summaries)
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && .venv/bin/pytest tests/test_compile_agent.py -v`

Expected: the three new tests pass. All previous tests still pass.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/compile.py backend/tests/test_compile_agent.py
git commit -m "feat(compile): reject raw HTML block tags in page bodies"
```

---

## Task 5: Backend — strip duplicate leading title in `render_page_md`

**Files:**
- Modify: `backend/kb/agents/compile_schema.py`
- Modify: `backend/tests/test_compile_schema.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_compile_schema.py`:

```python
def test_render_page_md_strips_leading_h1_matching_title():
    body = "# Foo Bar\n\nIntro paragraph. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body.startswith("# Foo Bar\n\nIntro paragraph.")
    assert rendered_body.count("# Foo Bar") == 1


def test_render_page_md_strips_leading_h2_matching_title():
    body = "## Foo Bar\n\nIntro paragraph. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body.startswith("# Foo Bar\n\nIntro paragraph.")
    assert "## Foo Bar" not in rendered_body


def test_render_page_md_preserves_body_when_title_not_repeated():
    body = "Intro paragraph. " + ("x" * 230)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert rendered_body == f"# Foo Bar\n\n{body}\n"


def test_render_page_md_does_not_strip_title_substring():
    body = "## Foo Bar Extra\n\nContent. " + ("x" * 220)
    page = WikiPageOutput(**_valid_page_kwargs(body=body))
    md = render_page_md(page, sources=["s.md"], updated=date(2026, 4, 20))
    _, rendered_body = parse_frontmatter(md)
    assert "## Foo Bar Extra" in rendered_body
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd backend && .venv/bin/pytest tests/test_compile_schema.py -v`

Expected: the first two new tests fail because the body currently contains both `# Foo Bar` (from the template) and `# Foo Bar` / `## Foo Bar` (from the body). The other two pass.

- [ ] **Step 3: Add the `_strip_leading_title` helper and wire it into `render_page_md`**

Modify `backend/kb/agents/compile_schema.py`:

```python
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd backend && .venv/bin/pytest tests/test_compile_schema.py -v`

Expected: all tests pass, including the four new ones.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/compile_schema.py backend/tests/test_compile_schema.py
git commit -m "feat(compile): strip duplicate leading title from page body on render"
```

---

## Task 6: Backend — tighten compile prompt

This task adds explicit output-format rules to `COMPILE_PROMPT`. Behavior is already enforced by Tasks 2, 4, and 5 — this task reinforces those rules at generation time. No new tests.

**Files:**
- Modify: `backend/kb/agents/compile.py`

- [ ] **Step 1: Update `COMPILE_PROMPT`**

Modify `backend/kb/agents/compile.py`. Change the `COMPILE_PROMPT` string to:

```python
COMPILE_PROMPT = """You compile a raw markdown document into structured wiki pages.

Produce one `WikiPageOutput` per distinct concept, entity, process, comparison, or framework found in the raw document. Split aggressively.

Each page has:
- slug: lowercase, hyphen-separated, matches `^[a-z0-9]+(-[a-z0-9]+)*$`.
- title: human-readable.
- summary: one paragraph synopsis (used as the index bullet).
- related: slugs of cross-linked pages; empty list if none. Each entry must match `^[a-z0-9]+(-[a-z0-9]+)*$`.
- body: free-form Markdown, at least 200 characters. Include whatever subheadings, lists, tables, and code blocks fit the concept.

Your output will be validated before it is written:
1. Every page body must be at least 200 characters.
2. Every fenced code block and every Markdown table present in the raw document must appear verbatim inside the body of at least one page.
3. The total length of all summaries and bodies combined must be at least {min_coverage:.0%} of the raw document length.

Output format rules (body field of each page):
- Use GitHub-Flavored Markdown only. Do not emit raw HTML block tags (<table>, <p>, <div>, <td>, <tr>, <thead>, <tbody>, <th>, <ul>, <ol>, <li>). Small inline HTML such as <br/>, <sub>, <sup>, <details> is allowed when useful.
- Tables must use pipe syntax (| col | col |) with a --- separator row, not HTML.
- Do not repeat the page title as a heading inside the body. The renderer already emits "# <title>" above the body; start the body with the first real subsection or paragraph.

Rephrase prose where it helps clarity, but preserve numeric facts, named entities, code blocks, and tables verbatim. Do not invent information that is not in the raw document.

EXISTING PAGES (slug — summary), for slug consistency and cross-linking only:
{existing_index}

RAW DOCUMENT (filename: {filename}):
{raw_content}
"""
```

- [ ] **Step 2: Run full backend tests**

Run: `cd backend && .venv/bin/pytest`

Expected: every test passes. The prompt is only sent to a mocked LLM in tests, so no existing assertion should regress.

- [ ] **Step 3: Commit**

```bash
git add backend/kb/agents/compile.py
git commit -m "feat(compile): add output-format rules to compile prompt"
```

---

## Task 7: Full verification

- [ ] **Step 1: Backend lint**

Run: `cd backend && .venv/bin/ruff check .`

Expected: `All checks passed!` (or equivalent clean output).

- [ ] **Step 2: Backend tests**

Run: `cd backend && .venv/bin/pytest`

Expected: full suite green.

- [ ] **Step 3: Frontend lint**

Run: `cd frontend && pnpm lint`

Expected: no errors.

- [ ] **Step 4: Frontend tests**

Run: `cd frontend && pnpm test`

Expected: full suite green.

- [ ] **Step 5: Report completion**

Summarize what changed and note the remaining manual step: *"To surface the fixes on the two currently broken pages, delete `backend/knowledge/wiki/pages/*.md`, `backend/knowledge/wiki/index.md`, and `backend/knowledge/wiki/log.md`, then re-ingest `backend/knowledge/raw/claude-modes-research.md` via the UI."* Do not perform this step automatically — it was explicitly deferred in the spec.

Do NOT run `git push`, `gh pr create`, or `gh pr merge` — those require a separate explicit user request.
