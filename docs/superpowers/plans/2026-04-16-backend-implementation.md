# Knowledge Base Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a FastAPI backend that implements Karpathy's LLM Wiki pattern — ingest markdown documents, compile them into a structured wiki via LiteLLM, and answer questions by querying the wiki with streaming SSE responses.

**Architecture:** Three-layer filesystem wiki (`raw/` → `wiki/` → query), two agents (CompileAgent, QueryAgent), REST API over FastAPI with SSE streaming for chat. LiteLLM abstracts the model so Claude API and Ollama both work via env var.

**Tech Stack:** Python 3.13, FastAPI 0.128.0, LiteLLM 1.83.3, pydantic-settings, sse-starlette, uv, pytest, pytest-asyncio

---

## File Map

```
backend/
  pyproject.toml             # All dependencies
  .env.example               # LLM_MODEL, KNOWLEDGE_DIR
  kb/
    __init__.py
    config.py                # Settings (pydantic-settings)
    wiki/
      __init__.py
      models.py              # Pydantic models: WikiPage, IngestJob, ChatRequest, LintResult
      fs.py                  # WikiFS — all filesystem operations
    agents/
      __init__.py
      compile.py             # CompileAgent: raw doc → wiki pages
      query.py               # QueryAgent: question → streamed answer
      lint.py                # LintAgent: find orphans + contradictions
    jobs/
      __init__.py
      store.py               # InMemoryJobStore keyed by UUID
    api/
      __init__.py
      ingest.py              # POST /api/ingest, GET /api/ingest/{job_id}
      wiki.py                # GET /api/wiki, GET /api/wiki/{slug}
      chat.py                # POST /api/chat (SSE)
      lint.py                # POST /api/lint
    main.py                  # App factory, router wiring, CORS
  knowledge/
    raw/.gitkeep
    wiki/
      index.md               # Initial empty index
      log.md                 # Initial empty log
      pages/.gitkeep
    schema/
      SCHEMA.md              # Wiki conventions + agent instructions
  tests/
    conftest.py              # Fixtures: tmp knowledge_dir, test client
    test_wiki_fs.py
    test_compile_agent.py
    test_query_agent.py
    test_api_ingest.py
    test_api_wiki.py
    test_api_chat.py
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/.env.example`
- Create: `backend/kb/__init__.py`
- Create: `backend/kb/config.py`

- [ ] **Step 1: Create `backend/pyproject.toml`**

```toml
[project]
name = "kb"
version = "0.1.0"
requires-python = ">=3.13"
dependencies = [
    "fastapi==0.128.0",
    "uvicorn[standard]>=0.34",
    "python-multipart>=0.0.20",
    "sse-starlette>=2.3",
    "litellm==1.83.3",
    "pydantic-settings>=2.9",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.4",
    "pytest-asyncio>=0.26",
    "httpx>=0.28",
    "pytest-mock>=3.14",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Create `.env.example`**

```
LLM_MODEL=claude-sonnet-4-6
KNOWLEDGE_DIR=knowledge
```

- [ ] **Step 3: Create `kb/__init__.py`**

```python
```

- [ ] **Step 4: Create `kb/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    llm_model: str = "claude-sonnet-4-6"
    knowledge_dir: Path = Path("knowledge")


settings = Settings()
```

- [ ] **Step 5: Install dependencies**

```bash
cd backend
uv venv
uv pip install -e ".[dev]"
```

Expected: dependencies install with no errors.

- [ ] **Step 6: Create the knowledge directory structure**

```bash
mkdir -p backend/knowledge/raw
mkdir -p backend/knowledge/wiki/pages
mkdir -p backend/knowledge/schema
touch backend/knowledge/raw/.gitkeep
touch backend/knowledge/wiki/pages/.gitkeep
```

- [ ] **Step 7: Create `knowledge/wiki/index.md`**

```markdown
# Knowledge Base Index

This file is maintained by the CompileAgent. Do not edit manually.

## Pages

<!-- Pages will be listed here by the CompileAgent -->
```

- [ ] **Step 8: Create `knowledge/wiki/log.md`**

```markdown
# Ingest Log

Append-only record of all ingest, query, and lint operations.
Format: `## [YYYY-MM-DD] operation | title`

```

- [ ] **Step 9: Create `knowledge/schema/SCHEMA.md`**

```markdown
# Wiki Schema

## Page Format

Each wiki page in `wiki/pages/` is a markdown file with this structure:

```markdown
# Page Title

**Slug:** slug-name
**Related:** [[other-slug]], [[another-slug]]
**Last updated:** YYYY-MM-DD

## Summary

One paragraph summary of this concept/entity/topic.

## Details

Full content, can be multiple sections.

## References

- Source: `raw/filename.md`
```

## Index Format

`wiki/index.md` contains a flat list of all pages, one per line:

```
- [[slug-name]] — One sentence description
```

The CompileAgent updates this list on every ingest.

## Log Format

Each log entry in `wiki/log.md`:

```
## [2026-04-16] ingest | Document Title
Pages touched: slug-one, slug-two, slug-three
```

## Naming Conventions

- Slugs: lowercase, hyphen-separated, no special chars (e.g. `database-migrations`)
- One page per distinct concept, entity, or process
- Backlinks use `[[slug]]` syntax
- A page should be ≤500 words; split longer content into sub-pages

## Agent Output Format

When the CompileAgent writes pages, it uses this delimiter format:

```
=== PAGE: slug-name ===
(full markdown content of the page)

=== INDEX ===
(full updated content of index.md)

=== LOG_ENTRY ===
## [YYYY-MM-DD] ingest | Document Title
Pages touched: slug-one, slug-two
```

The parser splits on `=== PAGE: `, `=== INDEX ===`, and `=== LOG_ENTRY ===`.
```

- [ ] **Step 10: Commit scaffold**

```bash
cd ..
git add backend/
git commit -m "feat(backend): project scaffold — FastAPI + LiteLLM + wiki structure"
```

---

## Task 2: Pydantic Models

**Files:**
- Create: `backend/kb/wiki/models.py`
- Create: `backend/kb/wiki/__init__.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_models.py`:

```python
from kb.wiki.models import WikiPage, IngestJob, JobStatus, ChatRequest, LintResult


def test_wiki_page_slug_from_filename():
    page = WikiPage(slug="database-migrations", content="# Database Migrations\n\nContent here.")
    assert page.slug == "database-migrations"
    assert "Database Migrations" in page.content


def test_ingest_job_defaults_to_pending():
    job = IngestJob(job_id="abc-123", filename="guide.md")
    assert job.status == JobStatus.PENDING
    assert job.error is None


def test_chat_request_requires_question():
    req = ChatRequest(question="How do we deploy?")
    assert req.question == "How do we deploy?"


def test_lint_result_has_issues_list():
    result = LintResult(orphans=["old-page"], contradictions=[])
    assert "old-page" in result.orphans
    assert result.contradictions == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
pytest tests/test_models.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.wiki.models'`

- [ ] **Step 3: Create `kb/wiki/__init__.py`**

```python
```

- [ ] **Step 4: Create `kb/wiki/models.py`**

```python
from enum import StrEnum
from pydantic import BaseModel


class JobStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class WikiPage(BaseModel):
    slug: str
    content: str


class IngestJob(BaseModel):
    job_id: str
    filename: str
    status: JobStatus = JobStatus.PENDING
    error: str | None = None


class ChatRequest(BaseModel):
    question: str


class LintResult(BaseModel):
    orphans: list[str]
    contradictions: list[str]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_models.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/wiki/ backend/tests/test_models.py
git commit -m "feat(backend): Pydantic models — WikiPage, IngestJob, ChatRequest, LintResult"
```

---

## Task 3: Wiki Filesystem Layer

**Files:**
- Create: `backend/kb/wiki/fs.py`
- Create: `backend/tests/conftest.py`
- Create: `backend/tests/test_wiki_fs.py`

- [ ] **Step 1: Create `tests/conftest.py`**

```python
import pytest
from pathlib import Path
from fastapi.testclient import TestClient


@pytest.fixture
def knowledge_dir(tmp_path: Path) -> Path:
    (tmp_path / "raw").mkdir()
    (tmp_path / "wiki" / "pages").mkdir(parents=True)
    (tmp_path / "schema").mkdir()
    (tmp_path / "wiki" / "index.md").write_text("# Index\n\n")
    (tmp_path / "wiki" / "log.md").write_text("")
    (tmp_path / "schema" / "SCHEMA.md").write_text("# Schema\n\n")
    return tmp_path
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_wiki_fs.py`:

```python
from pathlib import Path
from kb.wiki.fs import WikiFS


def test_read_index(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    content = fs.read_index()
    assert "# Index" in content


def test_write_and_read_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("test-topic", "# Test Topic\n\nContent here.")
    page = fs.read_page("test-topic")
    assert page.slug == "test-topic"
    assert "Test Topic" in page.content


def test_read_missing_page_raises(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    try:
        fs.read_page("nonexistent")
        assert False, "Should have raised"
    except FileNotFoundError:
        pass


def test_list_pages_empty(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    assert fs.list_pages() == []


def test_list_pages_after_write(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("topic-a", "# A")
    fs.write_page("topic-b", "# B")
    slugs = fs.list_pages()
    assert "topic-a" in slugs
    assert "topic-b" in slugs


def test_append_log(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.append_log("## [2026-04-16] ingest | Test Doc\nPages touched: topic-a")
    content = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "Test Doc" in content


def test_save_and_read_raw(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.save_raw("guide.md", "# Guide\n\nContent.")
    content = fs.read_raw("guide.md")
    assert "Guide" in content


def test_write_index(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_index("# Index\n\n- [[topic-a]] — A topic\n")
    assert "topic-a" in fs.read_index()


def test_read_schema(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    content = fs.read_schema()
    assert "# Schema" in content
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pytest tests/test_wiki_fs.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.wiki.fs'`

- [ ] **Step 4: Create `kb/wiki/fs.py`**

```python
from pathlib import Path
from kb.wiki.models import WikiPage


class WikiFS:
    def __init__(self, knowledge_dir: Path) -> None:
        self._raw = knowledge_dir / "raw"
        self._wiki = knowledge_dir / "wiki"
        self._pages = knowledge_dir / "wiki" / "pages"
        self._schema = knowledge_dir / "schema"

    def read_index(self) -> str:
        return (self._wiki / "index.md").read_text(encoding="utf-8")

    def write_index(self, content: str) -> None:
        (self._wiki / "index.md").write_text(content, encoding="utf-8")

    def read_page(self, slug: str) -> WikiPage:
        path = self._pages / f"{slug}.md"
        if not path.exists():
            raise FileNotFoundError(f"Wiki page not found: {slug}")
        return WikiPage(slug=slug, content=path.read_text(encoding="utf-8"))

    def write_page(self, slug: str, content: str) -> None:
        (self._pages / f"{slug}.md").write_text(content, encoding="utf-8")

    def list_pages(self) -> list[str]:
        return sorted(p.stem for p in self._pages.glob("*.md"))

    def append_log(self, entry: str) -> None:
        log_path = self._wiki / "log.md"
        existing = log_path.read_text(encoding="utf-8")
        log_path.write_text(existing + "\n" + entry + "\n", encoding="utf-8")

    def save_raw(self, filename: str, content: str) -> None:
        (self._raw / filename).write_text(content, encoding="utf-8")

    def read_raw(self, filename: str) -> str:
        return (self._raw / filename).read_text(encoding="utf-8")

    def read_schema(self) -> str:
        return (self._schema / "SCHEMA.md").read_text(encoding="utf-8")
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_wiki_fs.py -v
```

Expected: 9 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/wiki/fs.py backend/tests/
git commit -m "feat(backend): WikiFS filesystem layer with full test coverage"
```

---

## Task 4: Job Store

**Files:**
- Create: `backend/kb/jobs/__init__.py`
- Create: `backend/kb/jobs/store.py`
- Create: `backend/tests/test_job_store.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_job_store.py`:

```python
from kb.jobs.store import InMemoryJobStore
from kb.wiki.models import JobStatus


def test_create_and_get_job():
    store = InMemoryJobStore()
    job = store.create_job("report.md")
    retrieved = store.get_job(job.job_id)
    assert retrieved is not None
    assert retrieved.filename == "report.md"
    assert retrieved.status == JobStatus.PENDING


def test_update_job_status():
    store = InMemoryJobStore()
    job = store.create_job("doc.md")
    store.update_job(job.job_id, status=JobStatus.RUNNING)
    assert store.get_job(job.job_id).status == JobStatus.RUNNING


def test_update_job_with_error():
    store = InMemoryJobStore()
    job = store.create_job("doc.md")
    store.update_job(job.job_id, status=JobStatus.FAILED, error="LLM timeout")
    updated = store.get_job(job.job_id)
    assert updated.status == JobStatus.FAILED
    assert updated.error == "LLM timeout"


def test_get_missing_job_returns_none():
    store = InMemoryJobStore()
    assert store.get_job("no-such-id") is None
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_job_store.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `kb/jobs/__init__.py`**

```python
```

- [ ] **Step 4: Create `kb/jobs/store.py`**

```python
import uuid
from kb.wiki.models import IngestJob, JobStatus


class InMemoryJobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, IngestJob] = {}

    def create_job(self, filename: str) -> IngestJob:
        job = IngestJob(job_id=str(uuid.uuid4()), filename=filename)
        self._jobs[job.job_id] = job
        return job

    def get_job(self, job_id: str) -> IngestJob | None:
        return self._jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        *,
        status: JobStatus,
        error: str | None = None,
    ) -> None:
        job = self._jobs[job_id]
        self._jobs[job_id] = job.model_copy(update={"status": status, "error": error})
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_job_store.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/jobs/ backend/tests/test_job_store.py
git commit -m "feat(backend): InMemoryJobStore for compile job tracking"
```

---

## Task 5: CompileAgent

**Files:**
- Create: `backend/kb/agents/__init__.py`
- Create: `backend/kb/agents/compile.py`
- Create: `backend/tests/test_compile_agent.py`

- [ ] **Step 1: Create `kb/agents/__init__.py`**

```python
```

- [ ] **Step 2: Write the failing test**

Create `backend/tests/test_compile_agent.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.compile import CompileAgent
from kb.wiki.fs import WikiFS


MOCK_AGENT_OUTPUT = """=== PAGE: onboarding-guide ===
# Onboarding Guide

**Slug:** onboarding-guide
**Related:** 
**Last updated:** 2026-04-16

## Summary

Step-by-step guide for new engineers joining the team.

## Details

Follow these steps to get set up.

=== INDEX ===
# Knowledge Base Index

## Pages

- [[onboarding-guide]] — Step-by-step guide for new engineers joining the team.

=== LOG_ENTRY ===
## [2026-04-16] ingest | Onboarding Guide
Pages touched: onboarding-guide
"""


@pytest.mark.asyncio
async def test_compile_creates_wiki_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1: clone the repo.")

    page = fs.read_page("onboarding-guide")
    assert "Onboarding Guide" in page.content


@pytest.mark.asyncio
async def test_compile_updates_index(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1: clone the repo.")

    index = fs.read_index()
    assert "onboarding-guide" in index


@pytest.mark.asyncio
async def test_compile_appends_log(knowledge_dir):
    fs = WikiFS(knowledge_dir)

    mock_response = MagicMock()
    mock_response.choices[0].message.content = MOCK_AGENT_OUTPUT

    with patch("litellm.acompletion", new=AsyncMock(return_value=mock_response)):
        agent = CompileAgent(fs=fs, model="claude-sonnet-4-6")
        await agent.compile("onboarding.md", "# Onboarding\n\nStep 1.")

    log = (knowledge_dir / "wiki" / "log.md").read_text()
    assert "ingest" in log
```

- [ ] **Step 3: Run to verify failure**

```bash
pytest tests/test_compile_agent.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.agents.compile'`

- [ ] **Step 4: Create `kb/agents/compile.py`**

```python
import litellm
from kb.wiki.fs import WikiFS


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
    def __init__(self, fs: WikiFS, model: str) -> None:
        self._fs = fs
        self._model = model

    async def compile(self, filename: str, raw_content: str) -> None:
        schema = self._fs.read_schema()
        index = self._fs.read_index()

        existing_pages = ""
        for slug in self._fs.list_pages():
            page = self._fs.read_page(slug)
            existing_pages += f"\n--- {slug} ---\n{page.content}\n"

        prompt = COMPILE_PROMPT.format(
            schema=schema,
            index=index,
            existing_pages=existing_pages or "(none yet)",
            filename=filename,
            raw_content=raw_content,
        )

        response = await litellm.acompletion(
            model=self._model,
            messages=[{"role": "user", "content": prompt}],
        )
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
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_compile_agent.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/agents/ backend/tests/test_compile_agent.py
git commit -m "feat(backend): CompileAgent — raw markdown → structured wiki pages via LiteLLM"
```

---

## Task 6: QueryAgent

**Files:**
- Create: `backend/kb/agents/query.py`
- Create: `backend/tests/test_query_agent.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_query_agent.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.query import QueryAgent
from kb.wiki.fs import WikiFS


def _make_streaming_mock(tokens: list[str]):
    """Build a mock async iterator that yields SSE-style chunks."""
    async def _aiter():
        for token in tokens:
            chunk = MagicMock()
            chunk.choices[0].delta.content = token
            yield chunk

    mock = AsyncMock()
    mock.__aiter__ = _aiter
    return mock


@pytest.mark.asyncio
async def test_query_streams_answer(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy` to ship.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy the app.\n")

    # First call: page selection (non-streaming)
    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"

    # Second call: answer streaming
    stream_mock = _make_streaming_mock(["Run ", "`make deploy`", " to ship."])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query("How do I deploy?"):
            tokens.append(token)

    answer = "".join(tokens)
    assert len(tokens) > 0
    assert isinstance(answer, str)


@pytest.mark.asyncio
async def test_query_returns_citations(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy`.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["The answer.", "__CITATIONS__:deploy-process"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])):
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for token in agent.query("How do I deploy?"):
            tokens.append(token)

    assert any("deploy-process" in t for t in tokens)
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_query_agent.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.agents.query'`

- [ ] **Step 3: Create `kb/agents/query.py`**

```python
from typing import AsyncIterator
import litellm
from kb.wiki.fs import WikiFS


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
        select_response = await litellm.acompletion(
            model=self._model,
            messages=[{"role": "user", "content": SELECT_PROMPT.format(index=index, question=question)}],
        )
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
        stream = await litellm.acompletion(
            model=self._model,
            messages=[{"role": "user", "content": ANSWER_PROMPT.format(pages=pages_content, question=question)}],
            stream=True,
        )
        async for chunk in stream:
            token = chunk.choices[0].delta.content or ""
            if token:
                yield token
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_query_agent.py -v
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/query.py backend/tests/test_query_agent.py
git commit -m "feat(backend): QueryAgent — two-phase LLM query with SSE streaming"
```

---

## Task 7: LintAgent

**Files:**
- Create: `backend/kb/agents/lint.py`
- Create: `backend/tests/test_lint_agent.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_lint_agent.py`:

```python
import pytest
from kb.agents.lint import LintAgent
from kb.wiki.fs import WikiFS


def test_lint_finds_orphan_page(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    # Page exists in pages/ but is NOT referenced in index.md
    fs.write_page("orphan-page", "# Orphan\n\nNobody links to me.")
    fs.write_index("# Index\n\n- [[other-page]] — Some other page.\n")

    agent = LintAgent(fs=fs)
    result = agent.lint()

    assert "orphan-page" in result.orphans


def test_lint_no_orphans_when_all_indexed(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("known-page", "# Known\n\nContent.")
    fs.write_index("# Index\n\n- [[known-page]] — A known page.\n")

    agent = LintAgent(fs=fs)
    result = agent.lint()

    assert "known-page" not in result.orphans


def test_lint_returns_empty_contradictions_without_llm(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = LintAgent(fs=fs)
    result = agent.lint()
    assert result.contradictions == []
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_lint_agent.py -v
```

Expected: `ModuleNotFoundError`

- [ ] **Step 3: Create `kb/agents/lint.py`**

```python
from kb.wiki.fs import WikiFS
from kb.wiki.models import LintResult


class LintAgent:
    def __init__(self, fs: WikiFS) -> None:
        self._fs = fs

    def lint(self) -> LintResult:
        orphans = self._find_orphans()
        return LintResult(orphans=orphans, contradictions=[])

    def _find_orphans(self) -> list[str]:
        index = self._fs.read_index()
        all_slugs = self._fs.list_pages()
        return [slug for slug in all_slugs if f"[[{slug}]]" not in index]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pytest tests/test_lint_agent.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/lint.py backend/tests/test_lint_agent.py
git commit -m "feat(backend): LintAgent — orphan page detection"
```

---

## Task 8: Ingest API

**Files:**
- Create: `backend/kb/api/__init__.py`
- Create: `backend/kb/api/ingest.py`
- Create: `backend/kb/api/deps.py`
- Create: `backend/tests/test_api_ingest.py`

- [ ] **Step 1: Create `kb/api/__init__.py`**

```python
```

- [ ] **Step 2: Create `kb/api/deps.py`**

```python
from functools import lru_cache
from kb.wiki.fs import WikiFS
from kb.jobs.store import InMemoryJobStore
from kb.config import settings


@lru_cache
def get_wiki_fs() -> WikiFS:
    return WikiFS(settings.knowledge_dir)


@lru_cache
def get_job_store() -> InMemoryJobStore:
    return InMemoryJobStore()
```

- [ ] **Step 3: Write the failing test**

Create `backend/tests/test_api_ingest.py`:

```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from kb.main import create_app
from kb.api.deps import get_wiki_fs, get_job_store
from kb.wiki.fs import WikiFS
from kb.jobs.store import InMemoryJobStore


@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    store = InMemoryJobStore()
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    app.dependency_overrides[get_job_store] = lambda: store
    return TestClient(app), store


def test_ingest_returns_job_id(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        content = b"# Guide\n\nContent."
        response = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
    assert response.status_code == 202
    assert "job_id" in response.json()


def test_get_job_status(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock()
        content = b"# Guide\n\nContent."
        post_resp = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
    job_id = post_resp.json()["job_id"]
    get_resp = tc.get(f"/api/ingest/{job_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["job_id"] == job_id


def test_get_missing_job_returns_404(client):
    tc, _ = client
    response = tc.get("/api/ingest/no-such-id")
    assert response.status_code == 404
```

- [ ] **Step 4: Run to verify failure**

```bash
pytest tests/test_api_ingest.py -v
```

Expected: `ModuleNotFoundError: No module named 'kb.main'`

- [ ] **Step 5: Create `kb/api/ingest.py`**

```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from kb.agents.compile import CompileAgent
from kb.api.deps import get_job_store, get_wiki_fs
from kb.jobs.store import InMemoryJobStore
from kb.wiki.fs import WikiFS
from kb.wiki.models import JobStatus
from kb.config import settings

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


async def _run_compile(
    job_id: str,
    filename: str,
    raw_content: str,
    fs: WikiFS,
    store: InMemoryJobStore,
) -> None:
    store.update_job(job_id, status=JobStatus.RUNNING)
    try:
        fs.save_raw(filename, raw_content)
        agent = CompileAgent(fs=fs, model=settings.llm_model)
        await agent.compile(filename, raw_content)
        store.update_job(job_id, status=JobStatus.DONE)
    except Exception as exc:
        store.update_job(job_id, status=JobStatus.FAILED, error=str(exc))


@router.post("", status_code=202)
async def ingest_document(
    file: UploadFile,
    background_tasks: BackgroundTasks,
    fs: WikiFS = Depends(get_wiki_fs),
    store: InMemoryJobStore = Depends(get_job_store),
):
    raw_content = (await file.read()).decode("utf-8")
    job = store.create_job(file.filename or "upload.md")
    background_tasks.add_task(
        _run_compile, job.job_id, job.filename, raw_content, fs, store
    )
    return {"job_id": job.job_id, "status": job.status}


@router.get("/{job_id}")
def get_job_status(
    job_id: str,
    store: InMemoryJobStore = Depends(get_job_store),
):
    job = store.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
```

- [ ] **Step 6: Create minimal `kb/main.py`** (enough for tests to import)

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    return app


app = create_app()
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
pytest tests/test_api_ingest.py -v
```

Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add backend/kb/api/ backend/kb/main.py backend/tests/test_api_ingest.py
git commit -m "feat(backend): ingest API — POST /api/ingest + GET /api/ingest/{job_id}"
```

---

## Task 9: Wiki API

**Files:**
- Create: `backend/kb/api/wiki.py`
- Create: `backend/tests/test_api_wiki.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_wiki.py`:

```python
import pytest
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS


@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy`.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")
    return TestClient(app), fs


def test_list_wiki_pages(client):
    tc, _ = client
    response = tc.get("/api/wiki")
    assert response.status_code == 200
    slugs = response.json()["pages"]
    assert "deploy-process" in slugs


def test_get_wiki_page(client):
    tc, _ = client
    response = tc.get("/api/wiki/deploy-process")
    assert response.status_code == 200
    data = response.json()
    assert data["slug"] == "deploy-process"
    assert "Deploy Process" in data["content"]


def test_get_missing_wiki_page_returns_404(client):
    tc, _ = client
    response = tc.get("/api/wiki/nonexistent")
    assert response.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_api_wiki.py -v
```

Expected: 404 on `/api/wiki` (not registered yet).

- [ ] **Step 3: Create `kb/api/wiki.py`**

```python
from fastapi import APIRouter, Depends, HTTPException
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS

router = APIRouter(prefix="/api/wiki", tags=["wiki"])


@router.get("")
def list_pages(fs: WikiFS = Depends(get_wiki_fs)):
    return {"pages": fs.list_pages()}


@router.get("/{slug}")
def get_page(slug: str, fs: WikiFS = Depends(get_wiki_fs)):
    try:
        page = fs.read_page(slug)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Page '{slug}' not found")
    return page
```

- [ ] **Step 4: Add wiki router to `kb/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    return app


app = create_app()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_api_wiki.py -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/api/wiki.py backend/kb/main.py backend/tests/test_api_wiki.py
git commit -m "feat(backend): wiki API — GET /api/wiki + GET /api/wiki/{slug}"
```

---

## Task 10: Chat API (SSE)

**Files:**
- Create: `backend/kb/api/chat.py`
- Create: `backend/tests/test_api_chat.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_chat.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS


async def _mock_query(question: str):
    for token in ["The ", "answer ", "is here."]:
        yield token


@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    return TestClient(app), fs


def test_chat_returns_sse_stream(client):
    tc, _ = client
    with patch("kb.api.chat.QueryAgent") as MockAgent:
        MockAgent.return_value.query = _mock_query
        response = tc.post(
            "/api/chat",
            json={"question": "How do I deploy?"},
            headers={"Accept": "text/event-stream"},
        )
    assert response.status_code == 200
    assert "text/event-stream" in response.headers["content-type"]
    assert "answer" in response.text


def test_chat_rejects_empty_question(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"question": ""})
    assert response.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_api_chat.py -v
```

Expected: test_chat_returns_sse_stream fails (route not found), test_chat_rejects_empty_question may also fail.

- [ ] **Step 3: Create `kb/api/chat.py`**

```python
from fastapi import APIRouter, Depends
from pydantic import field_validator
from sse_starlette.sse import EventSourceResponse
from kb.agents.query import QueryAgent
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS
from kb.wiki.models import ChatRequest
from kb.config import settings

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ValidatedChatRequest(ChatRequest):
    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v


@router.post("")
async def chat(
    request: ValidatedChatRequest,
    fs: WikiFS = Depends(get_wiki_fs),
):
    agent = QueryAgent(fs=fs, model=settings.llm_model)

    async def event_generator():
        async for token in agent.query(request.question):
            yield {"data": token}

    return EventSourceResponse(event_generator())
```

- [ ] **Step 4: Add chat router to `kb/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    return app


app = create_app()
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest tests/test_api_chat.py -v
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/api/chat.py backend/kb/main.py backend/tests/test_api_chat.py
git commit -m "feat(backend): chat API — POST /api/chat with SSE streaming"
```

---

## Task 11: Lint API + Final Wiring

**Files:**
- Create: `backend/kb/api/lint.py`
- Modify: `backend/kb/main.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_api_lint.py`:

```python
from fastapi.testclient import TestClient
from kb.main import create_app
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS


def test_lint_returns_result(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    fs.write_page("orphan", "# Orphan")
    fs.write_index("# Index\n\n")
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    tc = TestClient(app)
    response = tc.post("/api/lint")
    assert response.status_code == 200
    data = response.json()
    assert "orphans" in data
    assert "orphan" in data["orphans"]
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest tests/test_api_lint.py -v
```

Expected: route not found.

- [ ] **Step 3: Create `kb/api/lint.py`**

```python
from fastapi import APIRouter, Depends
from kb.agents.lint import LintAgent
from kb.api.deps import get_wiki_fs
from kb.wiki.fs import WikiFS

router = APIRouter(prefix="/api/lint", tags=["lint"])


@router.post("")
def run_lint(fs: WikiFS = Depends(get_wiki_fs)):
    agent = LintAgent(fs=fs)
    return agent.lint()
```

- [ ] **Step 4: Update `kb/main.py` with lint router**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router
from kb.api.lint import router as lint_router


def create_app() -> FastAPI:
    app = FastAPI(title="Knowledge Base API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    app.include_router(lint_router)
    return app


app = create_app()
```

- [ ] **Step 5: Run all tests**

```bash
pytest -v
```

Expected: all tests pass (target: ~25 tests).

- [ ] **Step 6: Smoke test the running server**

```bash
cd backend
uvicorn kb.main:app --reload --port 8000
```

In another terminal:
```bash
curl http://localhost:8000/api/wiki
# Expected: {"pages":[]}
curl -X POST http://localhost:8000/api/lint
# Expected: {"orphans":[],"contradictions":[]}
```

- [ ] **Step 7: Commit**

```bash
git add backend/kb/api/lint.py backend/kb/main.py backend/tests/test_api_lint.py
git commit -m "feat(backend): lint API — POST /api/lint + complete app wiring"
```
