# MVP Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured JSON logging, a global exception handler with a flat error contract, origin-bound JWT session auth, and clean `<ErrorBanner>`-driven error display in the UI.

**Architecture:** Backend gets three middlewares (CORS → RequestContext → Auth), global exception handlers producing a flat `{code, message, request_id}` response, and a single unauthenticated `GET /api/auth/session` endpoint that mints an httpOnly `kb_session` JWT cookie if the `Origin` header matches an allowlist. Frontend centralizes error handling in `lib/api.ts` via an `ApiError` class, bootstraps the session once via `<SessionGate>` before any route renders, and surfaces errors through a single `<ErrorBanner>` component.

**Tech Stack:** Backend — FastAPI 0.128, Starlette, PyJWT (new), stdlib `logging`, pytest + `TestClient`. Frontend — React 19, React Router 7, Vitest + RTL.

**Spec reference:** `docs/superpowers/specs/2026-04-17-mvp-hardening-design.md`

**Working branch:** Suggested: `git checkout -b feature/mvp-hardening` before starting.

---

## File Structure

### New backend files
- `backend/kb/logging.py` — `setup_logging()`, `JsonFormatter`, `RequestIdFilter`, `request_id_var` contextvar
- `backend/kb/middleware.py` — `RequestContextMiddleware`
- `backend/kb/errors.py` — `ErrorCode`, `ErrorResponse`, `LLMUpstreamError`, handler functions
- `backend/kb/auth/__init__.py` — empty
- `backend/kb/auth/jwt.py` — `encode_session_jwt()`, `decode_session_jwt()`, `SessionTokenError`
- `backend/kb/auth/routes.py` — `GET /api/auth/session`
- `backend/kb/auth/middleware.py` — `AuthMiddleware`
- `backend/tests/test_errors.py`, `test_logging.py`, `test_middleware.py`, `test_healthz.py`
- `backend/tests/test_auth_jwt.py`, `test_auth_session.py`, `test_auth_middleware.py`

### Modified backend files
- `backend/pyproject.toml` — add `PyJWT`
- `backend/kb/config.py` — add `jwt_secret`, `jwt_ttl_seconds`, `allowed_origins`, `log_level`
- `backend/kb/main.py` — wire middlewares, handlers, `/healthz`, auth router
- `backend/kb/api/ingest.py` — log exceptions, store generic message
- `backend/kb/api/chat.py` — emit SSE error event on generator failure
- `backend/kb/agents/query.py`, `compile.py` — wrap `litellm` in `LLMUpstreamError`
- `backend/tests/conftest.py` — `JWT_SECRET` env var, `authenticated_client` helper
- `backend/tests/test_api_chat.py`, `test_api_ingest.py`, `test_api_lint.py`, `test_api_wiki.py` — use authenticated client
- `backend/.env.example`

### New frontend files
- `frontend/src/components/ErrorBanner.tsx`
- `frontend/src/components/SessionGate.tsx`
- `frontend/src/components/__tests__/ErrorBanner.test.tsx`
- `frontend/src/components/__tests__/SessionGate.test.tsx`
- `frontend/src/lib/__tests__/api.test.ts`
- `frontend/src/hooks/__tests__/useWiki.test.ts`, `useIngest.test.ts`

### Modified frontend files
- `frontend/src/lib/types.ts` — `ApiErrorBody`
- `frontend/src/lib/api.ts` — `ApiError`, `fetchJson` rewrite, `ensureSession`
- `frontend/src/App.tsx` — wrap routes in `<SessionGate>`
- `frontend/src/hooks/useChat.ts`, `useWiki.ts`, `useIngest.ts` — `ApiError` instead of `Error`
- `frontend/src/hooks/__tests__/useChat.test.ts` — `ApiError` + SSE error event
- `frontend/src/pages/ChatPage.tsx`, `WikiPage.tsx`, `IngestPage.tsx` — render `<ErrorBanner>`

---

## Phase 1 — Backend: contract, logging, middleware

### Task 1: Add PyJWT dependency, config fields, test env setup

**Files:**
- Modify: `backend/pyproject.toml`
- Modify: `backend/kb/config.py`
- Modify: `backend/.env.example`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/.env` (dev only — not committed)

- [ ] **Step 1: Add PyJWT to dependencies**

Edit `backend/pyproject.toml`, add `"PyJWT>=2.8",` to the `dependencies` list (between `pydantic-settings` and the closing `]`).

- [ ] **Step 2: Install the new dependency**

Run: `cd backend && uv sync --extra dev`
Expected: resolves PyJWT, adds to `.venv`.

- [ ] **Step 3: Extend config.py**

Replace the contents of `backend/kb/config.py` with:

```python
from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    llm_model: str = "claude-sonnet-4-6"
    knowledge_dir: Path = Path("knowledge")

    # Auth
    jwt_secret: str                                    # required, no default
    jwt_ttl_seconds: int = 86400                       # 24h
    allowed_origins: list[str] = ["http://localhost:5173"]

    # Observability
    log_level: str = "INFO"


settings = Settings()
```

- [ ] **Step 4: Update .env.example**

Replace `backend/.env.example` with:

```
LLM_MODEL=claude-sonnet-4-6
KNOWLEDGE_DIR=knowledge

# Required. Generate with:
#   python -c 'import secrets; print(secrets.token_urlsafe(32))'
JWT_SECRET=change-me

# Optional
JWT_TTL_SECONDS=86400
ALLOWED_ORIGINS=["http://localhost:5173"]
LOG_LEVEL=INFO
```

- [ ] **Step 5: Update your local backend/.env**

Append to your existing `backend/.env` (this file is gitignored):

```
JWT_SECRET=<paste output of: python -c 'import secrets; print(secrets.token_urlsafe(32))'>
```

- [ ] **Step 6: Update conftest.py to set JWT_SECRET before kb imports**

Replace `backend/tests/conftest.py` with:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest
from pathlib import Path

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

The `os.environ.setdefault` must come before any `import kb.*` — conftest runs before test modules, so this works.

- [ ] **Step 7: Verify existing test suite still passes**

Run: `cd backend && .venv/bin/pytest`
Expected: all existing tests pass (no behavior change yet).

- [ ] **Step 8: Commit**

```bash
git add backend/pyproject.toml backend/kb/config.py backend/.env.example backend/tests/conftest.py backend/uv.lock
git commit -m "chore(backend): add PyJWT + config fields for auth and logging"
```

---

### Task 2: Error code enum and flat error response model

**Files:**
- Create: `backend/kb/errors.py`
- Create: `backend/tests/test_errors.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_errors.py`:

```python
from kb.errors import ErrorCode, ErrorResponse


def test_error_codes_are_screaming_snake_case():
    expected = {
        "VALIDATION_ERROR",
        "UNAUTHENTICATED",
        "NOT_FOUND",
        "UPSTREAM_LLM_ERROR",
        "INTERNAL_ERROR",
    }
    assert {c.value for c in ErrorCode} == expected


def test_error_response_serialises_flat():
    resp = ErrorResponse(
        code=ErrorCode.NOT_FOUND,
        message="Job not found.",
        request_id="01HN6YV8XTR9A1TQ2M3X7E1B4C",
    )
    assert resp.model_dump() == {
        "code": "NOT_FOUND",
        "message": "Job not found.",
        "request_id": "01HN6YV8XTR9A1TQ2M3X7E1B4C",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_errors.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kb.errors'`.

- [ ] **Step 3: Implement the minimal module**

Create `backend/kb/errors.py`:

```python
from enum import Enum
from pydantic import BaseModel


class ErrorCode(str, Enum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNAUTHENTICATED = "UNAUTHENTICATED"
    NOT_FOUND = "NOT_FOUND"
    UPSTREAM_LLM_ERROR = "UPSTREAM_LLM_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorResponse(BaseModel):
    code: ErrorCode
    message: str
    request_id: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_errors.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/errors.py backend/tests/test_errors.py
git commit -m "feat(backend): add error code enum and flat error response model"
```

---

### Task 3: Structured JSON logging

**Files:**
- Create: `backend/kb/logging.py`
- Create: `backend/tests/test_logging.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_logging.py`:

```python
import json
import logging
from kb.logging import setup_logging, request_id_var


def test_json_formatter_emits_required_fields(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    logger.info("hello world", extra={"foo": "bar"})

    captured = capsys.readouterr().out.strip().splitlines()[-1]
    payload = json.loads(captured)
    assert payload["level"] == "INFO"
    assert payload["logger"] == "kb.test"
    assert payload["message"] == "hello world"
    assert "ts" in payload
    assert payload["foo"] == "bar"


def test_request_id_is_included_when_set(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    token = request_id_var.set("01HABC")
    try:
        logger.info("with id")
    finally:
        request_id_var.reset(token)

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert payload["request_id"] == "01HABC"


def test_request_id_omitted_when_unset(capsys):
    setup_logging(level="INFO")
    logger = logging.getLogger("kb.test")
    logger.info("no id")

    payload = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert "request_id" not in payload
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_logging.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kb.logging'`.

- [ ] **Step 3: Implement the logging module**

Create `backend/kb/logging.py`:

```python
import contextvars
import json
import logging
import sys
from datetime import datetime, timezone

request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)

_STANDARD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "request_id", "asctime",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        rid = getattr(record, "request_id", None)
        if rid:
            payload["request_id"] = rid
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        return json.dumps(payload, default=str)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get()
        return True


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())
    root.addHandler(handler)
    root.setLevel(level)
    # Silence noisy uvicorn access logger — we log request/response ourselves.
    logging.getLogger("uvicorn.access").propagate = False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_logging.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/logging.py backend/tests/test_logging.py
git commit -m "feat(backend): structured JSON logging with request_id contextvar"
```

---

### Task 4: Request context middleware

**Files:**
- Create: `backend/kb/middleware.py`
- Create: `backend/tests/test_middleware.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_middleware.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _build_app() -> FastAPI:
    setup_logging(level="INFO")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)

    @app.get("/ping")
    def ping():
        return {"ok": True}

    return app


def test_response_has_x_request_id_header():
    tc = TestClient(_build_app())
    response = tc.get("/ping")
    assert response.status_code == 200
    rid = response.headers.get("X-Request-ID")
    assert rid is not None and len(rid) >= 10


def test_request_ids_are_unique_per_request():
    tc = TestClient(_build_app())
    a = tc.get("/ping").headers["X-Request-ID"]
    b = tc.get("/ping").headers["X-Request-ID"]
    assert a != b
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_middleware.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'kb.middleware'`.

- [ ] **Step 3: Implement the middleware**

Create `backend/kb/middleware.py`:

```python
import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from kb.logging import request_id_var

logger = logging.getLogger(__name__)


def _new_request_id() -> str:
    # ULIDs would be nicer but uuid4 keeps the dep surface smaller and is unique.
    return uuid.uuid4().hex


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        rid = _new_request_id()
        token = request_id_var.set(rid)
        start = time.perf_counter()
        logger.info("request.start", extra={
            "event": "request.start",
            "method": request.method,
            "path": request.url.path,
        })
        try:
            response = await call_next(request)
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.exception("request.error", extra={
                "event": "request.error",
                "method": request.method,
                "path": request.url.path,
                "duration_ms": duration_ms,
            })
            raise
        else:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            logger.info("request.end", extra={
                "event": "request.end",
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": duration_ms,
            })
            response.headers["X-Request-ID"] = rid
            return response
        finally:
            request_id_var.reset(token)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_middleware.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/middleware.py backend/tests/test_middleware.py
git commit -m "feat(backend): request context middleware with request_id header"
```

---

### Task 5: LLM upstream error + wrap agents

**Files:**
- Modify: `backend/kb/errors.py`
- Modify: `backend/kb/agents/query.py`, `backend/kb/agents/compile.py`
- Modify: `backend/tests/test_query_agent.py`, `backend/tests/test_compile_agent.py`

- [ ] **Step 1: Write failing test for QueryAgent wrapping**

Add to `backend/tests/test_query_agent.py` (append — keep existing tests):

```python
import pytest
from unittest.mock import patch
from kb.agents.query import QueryAgent
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS


async def test_query_agent_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = QueryAgent(fs=fs, model="test-model")

    with patch("kb.agents.query.litellm.acompletion", side_effect=RuntimeError("boom")):
        with pytest.raises(LLMUpstreamError):
            async for _ in agent.query("hello?"):
                pass
```

- [ ] **Step 2: Write failing test for CompileAgent wrapping**

Add to `backend/tests/test_compile_agent.py` (append):

```python
import pytest
from unittest.mock import patch
from kb.agents.compile import CompileAgent
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS


async def test_compile_agent_wraps_litellm_errors(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    agent = CompileAgent(fs=fs, model="test-model")

    with patch("kb.agents.compile.litellm.acompletion", side_effect=RuntimeError("boom")):
        with pytest.raises(LLMUpstreamError):
            await agent.compile("file.md", "raw")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_query_agent.py::test_query_agent_wraps_litellm_errors tests/test_compile_agent.py::test_compile_agent_wraps_litellm_errors -v`
Expected: FAIL with `ImportError: cannot import name 'LLMUpstreamError'`.

- [ ] **Step 4: Add LLMUpstreamError to errors.py**

Append to `backend/kb/errors.py`:

```python


class LLMUpstreamError(Exception):
    """Raised when a downstream LLM call fails."""

    def __init__(self, message: str = "The language model is currently unavailable.") -> None:
        super().__init__(message)
        self.message = message
```

- [ ] **Step 5: Wrap litellm calls in QueryAgent**

Modify `backend/kb/agents/query.py`. Change the existing `query` method body so every `litellm.acompletion` call is wrapped:

```python
from typing import AsyncIterator
import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)

# ... keep SELECT_PROMPT and ANSWER_PROMPT unchanged ...


class QueryAgent:
    def __init__(self, fs: WikiFS, model: str) -> None:
        self._fs = fs
        self._model = model

    async def query(self, question: str) -> AsyncIterator[str]:
        index = self._fs.read_index()

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
```

- [ ] **Step 6: Wrap litellm calls in CompileAgent**

Modify `backend/kb/agents/compile.py`. In the `compile` method, wrap the `litellm.acompletion` call:

```python
import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)

# ... keep COMPILE_PROMPT unchanged ...


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

        try:
            response = await litellm.acompletion(
                model=self._model,
                messages=[{"role": "user", "content": prompt}],
            )
        except Exception as exc:
            logger.exception("llm.compile_failed")
            raise LLMUpstreamError() from exc

        output = response.choices[0].message.content
        self._parse_and_write(output)

    def _parse_and_write(self, output: str) -> None:
        # ... keep existing body unchanged ...
```

(When editing, keep the existing `_parse_and_write` body; only the top of the file and `compile` method change.)

- [ ] **Step 7: Run full test suite**

Run: `cd backend && .venv/bin/pytest`
Expected: all pass (including the two new wrap tests).

- [ ] **Step 8: Commit**

```bash
git add backend/kb/errors.py backend/kb/agents/query.py backend/kb/agents/compile.py backend/tests/test_query_agent.py backend/tests/test_compile_agent.py
git commit -m "feat(backend): wrap litellm errors in LLMUpstreamError"
```

---

### Task 6: Global exception handlers

**Files:**
- Modify: `backend/kb/errors.py`
- Modify: `backend/tests/test_errors.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_errors.py`:

```python
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from kb.errors import (
    LLMUpstreamError,
    install_error_handlers,
)
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging
from pydantic import BaseModel


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)

    class Body(BaseModel):
        n: int

    @app.get("/boom-http")
    def boom_http():
        raise HTTPException(status_code=404, detail="Thing not found.")

    @app.get("/boom-unknown")
    def boom_unknown():
        raise RuntimeError("internals leaked")

    @app.get("/boom-llm")
    def boom_llm():
        raise LLMUpstreamError()

    @app.post("/validate")
    def validate(body: Body):
        return {"n": body.n}

    return app


def test_http_exception_maps_to_flat_shape():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-http")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "NOT_FOUND"
    assert body["message"] == "Thing not found."
    assert body["request_id"] == r.headers["X-Request-ID"]


def test_unhandled_exception_returns_generic_500():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-unknown")
    assert r.status_code == 500
    body = r.json()
    assert body["code"] == "INTERNAL_ERROR"
    assert "internals leaked" not in body["message"]
    assert body["request_id"] == r.headers["X-Request-ID"]


def test_llm_upstream_error_maps_to_502():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.get("/boom-llm")
    assert r.status_code == 502
    body = r.json()
    assert body["code"] == "UPSTREAM_LLM_ERROR"


def test_validation_error_maps_to_422_with_flat_shape():
    tc = TestClient(_app(), raise_server_exceptions=False)
    r = tc.post("/validate", json={"n": "not-an-int"})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "n" in body["message"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_errors.py -v`
Expected: FAIL with `ImportError: cannot import name 'install_error_handlers'`.

- [ ] **Step 3: Implement handlers**

Append to `backend/kb/errors.py`:

```python
import logging
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request

from kb.logging import request_id_var

logger = logging.getLogger(__name__)


_STATUS_TO_CODE = {
    400: ErrorCode.VALIDATION_ERROR,
    401: ErrorCode.UNAUTHENTICATED,
    404: ErrorCode.NOT_FOUND,
    422: ErrorCode.VALIDATION_ERROR,
}


def _body(code: ErrorCode, message: str) -> dict:
    return {
        "code": code.value,
        "message": message,
        "request_id": request_id_var.get(),
    }


async def _http_exception_handler(request: Request, exc: HTTPException):
    code = _STATUS_TO_CODE.get(exc.status_code, ErrorCode.INTERNAL_ERROR)
    message = exc.detail if isinstance(exc.detail, str) else "Request failed."
    return JSONResponse(status_code=exc.status_code, content=_body(code, message))


async def _validation_error_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if errors:
        first = errors[0]
        loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
        message = f"{loc}: {first.get('msg', 'invalid')}" if loc else first.get("msg", "invalid")
    else:
        message = "Request validation failed."
    return JSONResponse(status_code=422, content=_body(ErrorCode.VALIDATION_ERROR, message))


async def _llm_upstream_handler(request: Request, exc: LLMUpstreamError):
    return JSONResponse(status_code=502, content=_body(ErrorCode.UPSTREAM_LLM_ERROR, exc.message))


async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception("unhandled_exception")
    rid = request_id_var.get() or "unknown"
    message = f"Something went wrong. Reference: {rid}."
    return JSONResponse(status_code=500, content=_body(ErrorCode.INTERNAL_ERROR, message))


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(HTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(LLMUpstreamError, _llm_upstream_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_errors.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/errors.py backend/tests/test_errors.py
git commit -m "feat(backend): global exception handlers producing flat error responses"
```

---

### Task 7: Wire middleware, handlers, and /healthz into main.py

**Files:**
- Modify: `backend/kb/main.py`
- Create: `backend/tests/test_healthz.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_healthz.py`:

```python
from fastapi.testclient import TestClient
from kb.main import create_app


def test_healthz_returns_ok():
    tc = TestClient(create_app())
    r = tc.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_unknown_route_returns_flat_not_found():
    tc = TestClient(create_app())
    r = tc.get("/does-not-exist")
    assert r.status_code == 404
    body = r.json()
    assert body["code"] == "NOT_FOUND"
    assert "request_id" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_healthz.py -v`
Expected: FAIL — `/healthz` returns 404.

- [ ] **Step 3: Rewrite main.py**

Replace `backend/kb/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router
from kb.api.lint import router as lint_router
from kb.config import settings
from kb.errors import install_error_handlers
from kb.logging import setup_logging
from kb.middleware import RequestContextMiddleware


def create_app() -> FastAPI:
    setup_logging(level=settings.log_level)

    app = FastAPI(title="Knowledge Base API")

    # Middleware order: add innermost first. On request, outermost runs first.
    # We want: CORS (outermost) → RequestContext → routes.
    # Auth middleware is added in Task 10.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(app)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    app.include_router(lint_router)
    return app


app = create_app()
```

Note `allow_credentials=True` (was not there before) — needed for cookie auth.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_healthz.py -v`
Expected: 2 passed.

- [ ] **Step 5: Run full suite**

Run: `cd backend && .venv/bin/pytest`
Expected: all pass. Existing `test_get_missing_wiki_page_returns_404` should continue passing (status 404 still returned; the response body shape changed but that test only checks `status_code`).

- [ ] **Step 6: Commit**

```bash
git add backend/kb/main.py backend/tests/test_healthz.py
git commit -m "feat(backend): wire logging, middleware, error handlers, and /healthz"
```

---

## Phase 2 — Backend: auth

### Task 8: JWT encode/decode utility

**Files:**
- Create: `backend/kb/auth/__init__.py`
- Create: `backend/kb/auth/jwt.py`
- Create: `backend/tests/test_auth_jwt.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_auth_jwt.py`:

```python
import time
import pytest
from kb.auth.jwt import encode_session_jwt, decode_session_jwt, SessionTokenError


def test_roundtrip_valid_token():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=60)
    claims = decode_session_jwt(token, secret="s3cret")
    assert claims["sub"] == "spa"
    assert claims["exp"] > claims["iat"]


def test_expired_token_raises():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=-1)
    with pytest.raises(SessionTokenError):
        decode_session_jwt(token, secret="s3cret")


def test_wrong_secret_raises():
    token = encode_session_jwt(secret="s3cret", ttl_seconds=60)
    with pytest.raises(SessionTokenError):
        decode_session_jwt(token, secret="other")


def test_garbage_raises():
    with pytest.raises(SessionTokenError):
        decode_session_jwt("not-a-jwt", secret="s3cret")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_auth_jwt.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement**

Create `backend/kb/auth/__init__.py` (empty file):

```python
```

Create `backend/kb/auth/jwt.py`:

```python
import time
import jwt as _pyjwt


class SessionTokenError(Exception):
    """Invalid, missing, or expired session token."""


def encode_session_jwt(secret: str, ttl_seconds: int) -> str:
    now = int(time.time())
    claims = {"sub": "spa", "iat": now, "exp": now + ttl_seconds}
    return _pyjwt.encode(claims, secret, algorithm="HS256")


def decode_session_jwt(token: str, secret: str) -> dict:
    try:
        return _pyjwt.decode(token, secret, algorithms=["HS256"])
    except _pyjwt.PyJWTError as exc:
        raise SessionTokenError(str(exc)) from exc
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_auth_jwt.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/auth/__init__.py backend/kb/auth/jwt.py backend/tests/test_auth_jwt.py
git commit -m "feat(backend): JWT encode/decode utility for session tokens"
```

---

### Task 9: /api/auth/session route

**Files:**
- Create: `backend/kb/auth/routes.py`
- Create: `backend/tests/test_auth_session.py`

- [ ] **Step 1: Write failing test**

Create `backend/tests/test_auth_session.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.auth.routes import router as auth_router
from kb.errors import install_error_handlers
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(auth_router)
    return app


def test_session_returns_204_with_cookie_for_allowed_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 204
    cookie = r.cookies.get("kb_session")
    assert cookie is not None and len(cookie) > 10
    # Must be httpOnly — check the raw Set-Cookie header.
    raw = r.headers.get("set-cookie", "")
    assert "HttpOnly" in raw
    assert "SameSite=lax" in raw.lower() or "samesite=lax" in raw.lower()


def test_session_rejects_disallowed_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "https://evil.example"})
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHENTICATED"


def test_session_rejects_missing_origin():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session")
    assert r.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_auth_session.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the route**

Create `backend/kb/auth/routes.py`:

```python
from fastapi import APIRouter, HTTPException, Request, Response

from kb.auth.jwt import encode_session_jwt
from kb.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

COOKIE_NAME = "kb_session"


@router.get("/session")
def bootstrap_session(request: Request):
    origin = request.headers.get("origin")
    if origin not in settings.allowed_origins:
        raise HTTPException(status_code=401, detail="Session required.")

    token = encode_session_jwt(
        secret=settings.jwt_secret,
        ttl_seconds=settings.jwt_ttl_seconds,
    )
    response = Response(status_code=204)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=settings.jwt_ttl_seconds,
        httponly=True,
        samesite="lax",
        path="/",
        # secure=True in production — leave off for dev (http://localhost).
    )
    return response
```

Note: build the `Response` explicitly and call `set_cookie` on it. Don't use `@router.get(..., status_code=204)` on a handler that returns a body/response — FastAPI strips bodies from 204 responses but leaves headers intact on an explicit `Response`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_auth_session.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/auth/routes.py backend/tests/test_auth_session.py
git commit -m "feat(backend): /api/auth/session mints httpOnly JWT cookie for allowed origins"
```

---

### Task 10: Auth middleware + wire + update existing test fixtures

**Files:**
- Create: `backend/kb/auth/middleware.py`
- Create: `backend/tests/test_auth_middleware.py`
- Modify: `backend/kb/main.py`
- Modify: `backend/tests/conftest.py`
- Modify: `backend/tests/test_api_chat.py`, `test_api_ingest.py`, `test_api_lint.py`, `test_api_wiki.py`

- [ ] **Step 1: Write failing test for the middleware in isolation**

Create `backend/tests/test_auth_middleware.py`:

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient
from kb.auth.middleware import AuthMiddleware
from kb.auth.routes import router as auth_router
from kb.errors import install_error_handlers
from kb.middleware import RequestContextMiddleware
from kb.logging import setup_logging


def _app() -> FastAPI:
    setup_logging(level="WARNING")
    app = FastAPI()
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestContextMiddleware)
    install_error_handlers(app)
    app.include_router(auth_router)

    @app.get("/api/private")
    def private():
        return {"ok": True}

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    return app


def test_private_route_without_cookie_returns_401():
    tc = TestClient(_app())
    r = tc.get("/api/private")
    assert r.status_code == 401
    assert r.json()["code"] == "UNAUTHENTICATED"


def test_private_route_with_valid_cookie_passes():
    tc = TestClient(_app())
    tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    r = tc.get("/api/private")
    assert r.status_code == 200


def test_session_route_is_bypass():
    tc = TestClient(_app())
    r = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 204


def test_healthz_is_bypass():
    tc = TestClient(_app())
    assert tc.get("/healthz").status_code == 200


def test_tampered_cookie_returns_401():
    tc = TestClient(_app())
    tc.cookies.set("kb_session", "not-a-valid-jwt")
    r = tc.get("/api/private")
    assert r.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_auth_middleware.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement the middleware**

Create `backend/kb/auth/middleware.py`:

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from kb.auth.jwt import SessionTokenError, decode_session_jwt
from kb.config import settings
from kb.errors import ErrorCode
from kb.logging import request_id_var
from kb.auth.routes import COOKIE_NAME

_BYPASS_PREFIXES = (
    "/api/auth/session",
    "/healthz",
    "/docs",
    "/openapi.json",
    "/redoc",
)


def _is_bypass(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") or path == p for p in _BYPASS_PREFIXES)


def _unauthenticated_response() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={
            "code": ErrorCode.UNAUTHENTICATED.value,
            "message": "Session required.",
            "request_id": request_id_var.get(),
        },
    )


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        if _is_bypass(request.url.path):
            return await call_next(request)

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return _unauthenticated_response()
        try:
            decode_session_jwt(token, secret=settings.jwt_secret)
        except SessionTokenError:
            return _unauthenticated_response()

        return await call_next(request)
```

- [ ] **Step 4: Run the middleware tests**

Run: `cd backend && .venv/bin/pytest tests/test_auth_middleware.py -v`
Expected: 5 passed.

- [ ] **Step 5: Wire auth into main.py**

Modify `backend/kb/main.py` — add the auth middleware and auth router. Replace the file:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from kb.api.ingest import router as ingest_router
from kb.api.wiki import router as wiki_router
from kb.api.chat import router as chat_router
from kb.api.lint import router as lint_router
from kb.auth.middleware import AuthMiddleware
from kb.auth.routes import router as auth_router
from kb.config import settings
from kb.errors import install_error_handlers
from kb.logging import setup_logging
from kb.middleware import RequestContextMiddleware


def create_app() -> FastAPI:
    setup_logging(level=settings.log_level)

    app = FastAPI(title="Knowledge Base API")

    # Middleware: added innermost-first, runs outermost-first on requests.
    # Order on the wire: CORS → RequestContext → Auth → routes.
    app.add_middleware(AuthMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    install_error_handlers(app)

    @app.get("/healthz")
    def healthz():
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(ingest_router)
    app.include_router(wiki_router)
    app.include_router(chat_router)
    app.include_router(lint_router)
    return app


app = create_app()
```

- [ ] **Step 6: Add an `authenticated_client` helper to conftest**

Replace `backend/tests/conftest.py`:

```python
import os
os.environ.setdefault("JWT_SECRET", "test-secret-not-for-production")

import pytest
from pathlib import Path
from fastapi import FastAPI
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


def authenticate(tc: TestClient) -> TestClient:
    """Call the session bootstrap so the client's cookie jar has kb_session."""
    resp = tc.get("/api/auth/session", headers={"Origin": "http://localhost:5173"})
    assert resp.status_code == 204, resp.text
    return tc
```

- [ ] **Step 7: Update each existing API test fixture to authenticate**

For each file below, change the `client` fixture so it calls `authenticate(tc)` after constructing the `TestClient`.

**`backend/tests/test_api_wiki.py`** — change the `client` fixture:

```python
from tests.conftest import authenticate

@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    fs.write_page("deploy-process", "# Deploy Process\n\nRun `make deploy`.")
    fs.write_index("# Index\n\n- [[deploy-process]] — How to deploy.\n")
    tc = TestClient(app)
    authenticate(tc)
    return tc, fs
```

**`backend/tests/test_api_chat.py`** — same pattern:

```python
from tests.conftest import authenticate

@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    tc = TestClient(app)
    authenticate(tc)
    return tc, fs
```

**`backend/tests/test_api_ingest.py`** — same pattern:

```python
from tests.conftest import authenticate

@pytest.fixture
def client(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    store = InMemoryJobStore()
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    app.dependency_overrides[get_job_store] = lambda: store
    tc = TestClient(app)
    authenticate(tc)
    return tc, store
```

**`backend/tests/test_api_lint.py`** — wrap the inline client:

```python
from tests.conftest import authenticate

def test_lint_returns_result(knowledge_dir):
    app = create_app()
    fs = WikiFS(knowledge_dir)
    fs.write_page("orphan", "# Orphan")
    fs.write_index("# Index\n\n")
    app.dependency_overrides[get_wiki_fs] = lambda: fs
    tc = TestClient(app)
    authenticate(tc)
    response = tc.post("/api/lint")
    assert response.status_code == 200
    data = response.json()
    assert "orphans" in data
    assert "orphan" in data["orphans"]
```

- [ ] **Step 8: Run the full suite**

Run: `cd backend && .venv/bin/pytest`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add backend/kb/auth/middleware.py backend/kb/main.py backend/tests/test_auth_middleware.py backend/tests/conftest.py backend/tests/test_api_chat.py backend/tests/test_api_ingest.py backend/tests/test_api_lint.py backend/tests/test_api_wiki.py
git commit -m "feat(backend): auth middleware enforces kb_session JWT cookie on /api/*"
```

---

## Phase 3 — Backend: cleanup

### Task 11: Ingest background task error handling

**Files:**
- Modify: `backend/kb/api/ingest.py`
- Modify: `backend/tests/test_api_ingest.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_api_ingest.py` (tests that the failure path doesn't leak `str(exc)`):

```python
from unittest.mock import AsyncMock, patch
from kb.wiki.models import JobStatus


def test_ingest_failure_stores_generic_message_not_exception_str(client):
    tc, store = client
    with patch("kb.api.ingest.CompileAgent") as MockAgent:
        MockAgent.return_value.compile = AsyncMock(
            side_effect=RuntimeError("secret/path/leaked.py line 42")
        )
        content = b"# Guide\n\nContent."
        resp = tc.post("/api/ingest", files={"file": ("guide.md", content, "text/markdown")})
        assert resp.status_code == 202
        job_id = resp.json()["job_id"]

        # TestClient's sync client waits for BackgroundTasks to complete before
        # returning the response — so the job is already in terminal state here.
        job = store.get_job(job_id)
        assert job.status == JobStatus.FAILED
        assert job.error == "Ingest failed."
        assert "secret/path" not in (job.error or "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_api_ingest.py::test_ingest_failure_stores_generic_message_not_exception_str -v`
Expected: FAIL — current code stores `str(exc)` which contains `"secret/path/leaked.py line 42"`.

- [ ] **Step 3: Modify `_run_compile`**

Edit `backend/kb/api/ingest.py`. Replace the `_run_compile` function:

```python
import logging

logger = logging.getLogger(__name__)


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
    except Exception:
        logger.exception("ingest.compile_failed", extra={"job_id": job_id, "filename": filename})
        store.update_job(job_id, status=JobStatus.FAILED, error="Ingest failed.")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_api_ingest.py -v`
Expected: all ingest tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/api/ingest.py backend/tests/test_api_ingest.py
git commit -m "fix(backend): ingest job error message no longer leaks exception internals"
```

---

### Task 12: SSE chat error event

**Files:**
- Modify: `backend/kb/api/chat.py`
- Modify: `backend/tests/test_api_chat.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_api_chat.py`:

```python
async def _mock_query_raises(question: str):
    yield "hello"
    raise __import__("kb.errors", fromlist=["LLMUpstreamError"]).LLMUpstreamError()


def test_chat_emits_terminal_error_event_on_stream_failure(client):
    tc, _ = client
    with patch("kb.api.chat.QueryAgent") as MockAgent:
        MockAgent.return_value.query = _mock_query_raises
        with tc.stream("POST", "/api/chat", json={"question": "why?"}) as resp:
            assert resp.status_code == 200
            body = b"".join(resp.iter_bytes()).decode("utf-8")

    # Expect the partial token then an event: error frame with the flat error json.
    assert "data: hello" in body
    assert "event: error" in body
    assert "UPSTREAM_LLM_ERROR" in body
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_api_chat.py::test_chat_emits_terminal_error_event_on_stream_failure -v`
Expected: FAIL — current code lets the exception propagate (which produces a 500, not a terminal error frame).

- [ ] **Step 3: Modify the chat route**

Replace `backend/kb/api/chat.py`:

```python
import json
import logging

from fastapi import APIRouter, Depends
from pydantic import field_validator
from sse_starlette.sse import EventSourceResponse

from kb.agents.query import QueryAgent
from kb.api.deps import get_wiki_fs
from kb.config import settings
from kb.errors import ErrorCode, LLMUpstreamError
from kb.logging import request_id_var
from kb.wiki.fs import WikiFS
from kb.wiki.models import ChatRequest

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])


class ValidatedChatRequest(ChatRequest):
    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v


def _error_event(code: ErrorCode, message: str) -> dict:
    payload = {
        "code": code.value,
        "message": message,
        "request_id": request_id_var.get(),
    }
    return {"event": "error", "data": json.dumps(payload)}


@router.post("")
async def chat(
    request: ValidatedChatRequest,
    fs: WikiFS = Depends(get_wiki_fs),
):
    agent = QueryAgent(fs=fs, model=settings.llm_model)

    async def event_generator():
        try:
            async for token in agent.query(request.question):
                yield {"data": token}
        except LLMUpstreamError as exc:
            logger.warning("chat.stream_llm_error")
            yield _error_event(ErrorCode.UPSTREAM_LLM_ERROR, exc.message)
        except Exception:
            logger.exception("chat.stream_failed")
            yield _error_event(ErrorCode.INTERNAL_ERROR, "Stream failed. Please try again.")

    return EventSourceResponse(event_generator())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_api_chat.py -v`
Expected: all chat tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/api/chat.py backend/tests/test_api_chat.py
git commit -m "feat(backend): SSE chat emits terminal error event on stream failure"
```

---

## Phase 4 — Frontend: API client + session bootstrap

### Task 13: ApiError class and types

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/__tests__/api.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/__tests__/api.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ApiError } from '../api'

describe('ApiError', () => {
  it('is an Error subclass with fields', () => {
    const err = new ApiError({
      code: 'NOT_FOUND',
      message: 'Job not found.',
      requestId: '01H',
      status: 404,
    })
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('Job not found.')
    expect(err.requestId).toBe('01H')
    expect(err.status).toBe(404)
    expect(err.name).toBe('ApiError')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: FAIL — `ApiError` not exported.

- [ ] **Step 3: Add the type for error bodies**

Append to `frontend/src/lib/types.ts`:

```ts
export interface ApiErrorBody {
  code: string
  message: string
  request_id: string | null
}
```

- [ ] **Step 4: Add ApiError to api.ts**

Prepend to `frontend/src/lib/api.ts` (before the existing `fetchJson`):

```ts
import type { WikiPage, IngestJob, LintResult, ApiErrorBody } from './types'

export class ApiError extends Error {
  code: string
  requestId: string | null
  status: number

  constructor(init: { code: string; message: string; requestId: string | null; status: number }) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.requestId = init.requestId
    this.status = init.status
  }
}
```

(Replace the existing first-line `import type { WikiPage, IngestJob, LintResult } from './types'` with the new line above that also imports `ApiErrorBody`.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: 1 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/lib/api.ts frontend/src/lib/__tests__/api.test.ts
git commit -m "feat(frontend): ApiError class and ApiErrorBody type"
```

---

### Task 14: Rewrite `fetchJson` — credentials + flat error parsing

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/__tests__/api.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `frontend/src/lib/__tests__/api.test.ts`:

```ts
import { vi, beforeEach, afterEach } from 'vitest'
import { getWikiPages } from '../api'

function mockFetchOnce(init: { ok: boolean; status?: number; body?: unknown; headers?: Record<string, string> }) {
  const res = {
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    headers: new Headers(init.headers ?? {}),
    json: async () => init.body,
  } as unknown as Response
  return vi.fn().mockResolvedValueOnce(res)
}

describe('fetchJson', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('sends credentials: include on every request', async () => {
    const fetchMock = mockFetchOnce({ ok: true, body: { pages: [] } })
    vi.stubGlobal('fetch', fetchMock)

    await getWikiPages()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0][1] ?? {}
    expect(init.credentials).toBe('include')
  })

  it('parses flat error body into ApiError', async () => {
    const fetchMock = mockFetchOnce({
      ok: false,
      status: 404,
      body: { code: 'NOT_FOUND', message: 'Page not found.', request_id: '01H' },
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(getWikiPages()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'NOT_FOUND',
      message: 'Page not found.',
      requestId: '01H',
      status: 404,
    })
  })

  it('falls back to synthetic INTERNAL_ERROR when body is not JSON', async () => {
    const res = {
      ok: false,
      status: 502,
      headers: new Headers({ 'X-Request-ID': '01HXYZ' }),
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(res))

    await expect(getWikiPages()).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INTERNAL_ERROR',
      status: 502,
      requestId: '01HXYZ',
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: the new tests FAIL — current `fetchJson` doesn't send credentials and throws plain `Error`.

- [ ] **Step 3: Rewrite `fetchJson` and the helpers in `api.ts`**

Replace the contents of `frontend/src/lib/api.ts` with:

```ts
import type { WikiPage, IngestJob, LintResult, ApiErrorBody } from './types'

export class ApiError extends Error {
  code: string
  requestId: string | null
  status: number

  constructor(init: { code: string; message: string; requestId: string | null; status: number }) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.requestId = init.requestId
    this.status = init.status
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  )
}

async function toApiError(res: Response): Promise<ApiError> {
  const requestIdHeader = res.headers.get('X-Request-ID')
  try {
    const body: unknown = await res.json()
    if (isApiErrorBody(body)) {
      return new ApiError({
        code: body.code,
        message: body.message,
        requestId: body.request_id ?? requestIdHeader,
        status: res.status,
      })
    }
  } catch {
    // Fall through to synthetic error below.
  }
  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: `Request failed (${res.status}).`,
    requestId: requestIdHeader,
    status: res.status,
  })
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) throw await toApiError(res)
  return res.json() as Promise<T>
}

export async function getWikiPages(): Promise<string[]> {
  const data = await fetchJson<{ pages: string[] }>('/api/wiki')
  return data.pages
}

export async function getWikiPage(slug: string): Promise<WikiPage> {
  return fetchJson<WikiPage>(`/api/wiki/${slug}`)
}

export async function ingestFile(file: File): Promise<IngestJob> {
  const form = new FormData()
  form.append('file', file)
  return fetchJson<IngestJob>('/api/ingest', { method: 'POST', body: form })
}

export async function getIngestJob(jobId: string): Promise<IngestJob> {
  return fetchJson<IngestJob>(`/api/ingest/${jobId}`)
}

export async function runLint(): Promise<LintResult> {
  return fetchJson<LintResult>('/api/lint', { method: 'POST' })
}

/**
 * Opens an SSE stream for a chat question.
 * Returns the raw Response — caller handles the stream.
 */
export async function startChat(question: string): Promise<Response> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw await toApiError(res)
  return res
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/__tests__/api.test.ts
git commit -m "feat(frontend): fetchJson sends credentials and throws ApiError from flat body"
```

---

### Task 15: `ensureSession` with memoization

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/__tests__/api.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `frontend/src/lib/__tests__/api.test.ts`:

```ts
import { ensureSession, resetSessionPromise } from '../api'

describe('ensureSession', () => {
  beforeEach(() => {
    resetSessionPromise()
    vi.restoreAllMocks()
  })

  it('calls /api/auth/session once for concurrent callers', async () => {
    const res = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValue(res)
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([ensureSession(), ensureSession(), ensureSession()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/session')
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include')
  })

  it('throws ApiError on failure and allows retry after reset', async () => {
    const failRes = {
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ code: 'UNAUTHENTICATED', message: 'nope', request_id: null }),
    } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(failRes))

    await expect(ensureSession()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })

    resetSessionPromise()

    const okRes = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okRes))

    await expect(ensureSession()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: FAIL — `ensureSession` not exported.

- [ ] **Step 3: Add `ensureSession` to api.ts**

Append to `frontend/src/lib/api.ts`:

```ts
let sessionPromise: Promise<void> | null = null

export async function ensureSession(): Promise<void> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const res = await fetch('/api/auth/session', { credentials: 'include' })
    if (!res.ok) {
      // Reset so callers can retry after handling the error.
      const err = await toApiError(res)
      sessionPromise = null
      throw err
    }
  })()
  return sessionPromise
}

/** Clears the memoized session promise so the next ensureSession() issues a fresh bootstrap. */
export function resetSessionPromise(): void {
  sessionPromise = null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/__tests__/api.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/__tests__/api.test.ts
git commit -m "feat(frontend): ensureSession bootstraps kb_session cookie (memoized)"
```

---

## Phase 5 — Frontend: components

### Task 16: ErrorBanner component

**Files:**
- Create: `frontend/src/components/ErrorBanner.tsx`
- Create: `frontend/src/components/__tests__/ErrorBanner.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/ErrorBanner.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBanner } from '../ErrorBanner'
import { ApiError } from '../../lib/api'

describe('ErrorBanner', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorBanner error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders message and request id', () => {
    const err = new ApiError({ code: 'NOT_FOUND', message: 'Missing.', requestId: '01HREQ', status: 404 })
    render(<ErrorBanner error={err} />)
    expect(screen.getByText('Missing.')).toBeInTheDocument()
    expect(screen.getByText(/01HREQ/)).toBeInTheDocument()
  })

  it('shows Retry when onRetry provided and calls it', async () => {
    const err = new ApiError({ code: 'INTERNAL_ERROR', message: 'Oops.', requestId: null, status: 500 })
    const onRetry = vi.fn()
    render(<ErrorBanner error={err} onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/ErrorBanner.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/ErrorBanner.tsx`:

```tsx
import type { ApiError } from '../lib/api'

interface Props {
  error: ApiError | null
  onRetry?: () => void
}

export function ErrorBanner({ error, onRetry }: Props) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="bg-warm-sand border border-border-cream text-near-black rounded-md px-4 py-3 font-sans text-sm flex items-start gap-3"
    >
      <div className="flex-1">
        <p className="font-medium">{error.message}</p>
        {error.requestId && (
          <p className="text-xs text-stone-gray mt-1">Reference: {error.requestId}</p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs font-medium text-olive-gray hover:text-near-black underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/ErrorBanner.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ErrorBanner.tsx frontend/src/components/__tests__/ErrorBanner.test.tsx
git commit -m "feat(frontend): ErrorBanner component for ApiError display"
```

---

### Task 17: SessionGate (with inline loading) and wire into App.tsx

**Files:**
- Create: `frontend/src/components/SessionGate.tsx`
- Create: `frontend/src/components/__tests__/SessionGate.test.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/SessionGate.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SessionGate } from '../SessionGate'
import { resetSessionPromise } from '../../lib/api'

describe('SessionGate', () => {
  beforeEach(() => {
    resetSessionPromise()
    vi.restoreAllMocks()
  })

  it('shows loading then renders children on successful bootstrap', async () => {
    const ok = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok))

    render(
      <SessionGate>
        <div>hello</div>
      </SessionGate>,
    )

    expect(screen.getByText(/signing in/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
  })

  it('shows ErrorBanner with retry on failure', async () => {
    const fail = {
      ok: false,
      status: 401,
      headers: new Headers(),
      json: async () => ({ code: 'UNAUTHENTICATED', message: 'Session required.', request_id: null }),
    } as unknown as Response
    const ok = { ok: true, status: 204, headers: new Headers(), json: async () => ({}) } as unknown as Response
    const fetchMock = vi.fn().mockResolvedValueOnce(fail).mockResolvedValueOnce(ok)
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SessionGate>
        <div>hello</div>
      </SessionGate>,
    )

    await waitFor(() => expect(screen.getByText('Session required.')).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/SessionGate.test.tsx`
Expected: FAIL — component does not exist.

- [ ] **Step 3: Implement SessionGate**

Create `frontend/src/components/SessionGate.tsx`:

```tsx
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ensureSession, ApiError, resetSessionPromise } from '../lib/api'

import { ErrorBanner } from './ErrorBanner'

interface Props {
  children: ReactNode
}

type State =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: ApiError }

export function SessionGate({ children }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })

  const bootstrap = useCallback(() => {
    setState({ status: 'loading' })
    ensureSession()
      .then(() => setState({ status: 'ready' }))
      .catch((err: unknown) => {
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError({ code: 'INTERNAL_ERROR', message: 'Could not start session.', requestId: null, status: 0 })
        setState({ status: 'error', error: apiErr })
      })
  }, [])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-stone-gray font-sans animate-pulse">Signing in…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-6 max-w-lg mx-auto mt-12">
        <ErrorBanner
          error={state.error}
          onRetry={() => {
            resetSessionPromise()
            bootstrap()
          }}
        />
      </div>
    )
  }

  return <>{children}</>
}
```

Note: `resetSessionPromise` is called on retry because the memoized `sessionPromise` would otherwise keep returning the cached failure.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/SessionGate.test.tsx`
Expected: 2 passed.

- [ ] **Step 5: Wire SessionGate into App.tsx**

Replace `frontend/src/App.tsx`:

```tsx
import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { SessionGate } from './components/SessionGate'
import { ChatPage } from './pages/ChatPage'
import { WikiPage } from './pages/WikiPage'
import { IngestPage } from './pages/IngestPage'

export function App() {
  return (
    <SessionGate>
      <div className="flex flex-col h-screen bg-parchment">
        {/* Top nav */}
        <header className="h-13 flex items-center justify-between px-6 border-b border-border-cream bg-parchment flex-shrink-0">
          <span className="font-serif text-base font-medium text-near-black">Knowledge Base</span>
        </header>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/wiki" element={<WikiPage />} />
              <Route path="/wiki/:slug" element={<WikiPage />} />
              <Route path="/ingest" element={<IngestPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </SessionGate>
  )
}
```

- [ ] **Step 6: Run full frontend suite**

Run: `cd frontend && pnpm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/SessionGate.tsx frontend/src/components/__tests__/SessionGate.test.tsx frontend/src/App.tsx
git commit -m "feat(frontend): SessionGate bootstraps kb_session before routes render"
```

---

## Phase 6 — Frontend: hooks and pages

### Task 18: Update `useChat` — ApiError + SSE error event

**Files:**
- Modify: `frontend/src/hooks/useChat.ts`
- Modify: `frontend/src/hooks/__tests__/useChat.test.ts`

- [ ] **Step 1: Write failing tests (append)**

Append to `frontend/src/hooks/__tests__/useChat.test.ts`:

```ts
import { ApiError } from '../../lib/api'

function makeErrorEventResponse(tokens: string[], errorBody: { code: string; message: string; request_id: string | null }) {
  // SSE mixed frames: `data: token\n\n` ... `event: error\ndata: {json}\n\n`
  const body =
    tokens.map(t => `data: ${t}\n\n`).join('') +
    `event: error\ndata: ${JSON.stringify(errorBody)}\n\n`
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return { ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response
}

describe('useChat error surfaces', () => {
  it('exposes error: ApiError when the SSE stream emits an error event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeErrorEventResponse(['Hello '], {
        code: 'UPSTREAM_LLM_ERROR',
        message: 'The language model is currently unavailable.',
        request_id: '01H',
      }),
    ))

    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage('why?')
    })

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.code).toBe('UPSTREAM_LLM_ERROR')
    // Prior tokens preserved on the assistant message.
    expect(result.current.messages[1].content).toContain('Hello')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useChat.test.ts`
Expected: FAIL — `result.current.error` doesn't exist yet.

- [ ] **Step 3: Rewrite `useChat`**

Replace `frontend/src/hooks/useChat.ts`:

```ts
import { useState, useCallback } from 'react'
import { ApiError, startChat } from '../lib/api'
import type { ChatMessage, ApiErrorBody } from '../lib/types'

const CITATIONS_MARKER = '__CITATIONS__:'

function parseToken(token: string, msg: ChatMessage): ChatMessage {
  if (token.includes(CITATIONS_MARKER)) {
    const [text, citationsPart] = token.split(CITATIONS_MARKER)
    const citations = citationsPart.split(',').map(s => s.trim()).filter(Boolean)
    return { ...msg, content: msg.content + text, citations }
  }
  return { ...msg, content: msg.content + token }
}

interface SSEFrame {
  event: string | null
  data: string
}

function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = []
  const parts = buffer.split('\n\n')
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    if (!part.trim()) continue
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const sendMessage = useCallback(async (question: string) => {
    setError(null)

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question, citations: [] }
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', citations: [] }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    try {
      const response = await startChat(question)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = parseSSEFrames(buffer)
        buffer = rest

        for (const frame of frames) {
          if (frame.event === 'error') {
            try {
              const body = JSON.parse(frame.data) as ApiErrorBody
              setError(new ApiError({
                code: body.code,
                message: body.message,
                requestId: body.request_id,
                status: 200, // stream succeeded at HTTP level; error came mid-stream
              }))
            } catch {
              setError(new ApiError({
                code: 'INTERNAL_ERROR',
                message: 'Stream failed.',
                requestId: null,
                status: 200,
              }))
            }
          } else {
            const token = frame.data
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last.id !== assistantMsg.id) return prev
              return [...prev.slice(0, -1), parseToken(token, last)]
            })
          }
        }
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e)
      } else {
        setError(new ApiError({ code: 'INTERNAL_ERROR', message: 'Stream failed.', requestId: null, status: 0 }))
      }
      // Keep the user message; drop the empty assistant placeholder only if nothing streamed.
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last.id === assistantMsg.id && last.content === '') {
          return prev.slice(0, -1)
        }
        return prev
      })
    } finally {
      setStreaming(false)
    }
  }, [])

  return { messages, streaming, sendMessage, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useChat.test.ts`
Expected: all pass (both the existing test and the new error test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/src/hooks/__tests__/useChat.test.ts
git commit -m "feat(frontend): useChat exposes ApiError and handles SSE error events"
```

---

### Task 19: Update `useWiki` — ApiError

**Files:**
- Modify: `frontend/src/hooks/useWiki.ts`
- Create: `frontend/src/hooks/__tests__/useWiki.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/__tests__/useWiki.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useWikiPages, useWikiPage } from '../useWiki'
import { ApiError } from '../../lib/api'

beforeEach(() => vi.restoreAllMocks())

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

describe('useWikiPages', () => {
  it('loads pages on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ pages: ['a', 'b'] })))
    const { result } = renderHook(() => useWikiPages())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.pages).toEqual(['a', 'b'])
    expect(result.current.error).toBeNull()
  })

  it('exposes ApiError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'INTERNAL_ERROR', message: 'boom', request_id: '01H' }, false, 500),
    ))
    const { result } = renderHook(() => useWikiPages())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.code).toBe('INTERNAL_ERROR')
  })
})

describe('useWikiPage', () => {
  it('returns page on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonRes({ slug: 'a', content: '# A' })))
    const { result } = renderHook(() => useWikiPage('a'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.page?.slug).toBe('a')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useWiki.test.ts`
Expected: FAIL — `error` is currently `string | null`, not `ApiError`.

- [ ] **Step 3: Rewrite `useWiki`**

Replace `frontend/src/hooks/useWiki.ts`:

```ts
import { useState, useEffect } from 'react'
import { ApiError, getWikiPages, getWikiPage } from '../lib/api'
import type { WikiPage } from '../lib/types'

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError({ code: 'INTERNAL_ERROR', message: 'Request failed.', requestId: null, status: 0 })
}

export function useWikiPages() {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    getWikiPages()
      .then(p => {
        setPages(p)
        setError(null)
      })
      .catch(e => setError(toApiError(e)))
      .finally(() => setLoading(false))
  }, [])

  return { pages, loading, error }
}

export function useWikiPage(slug: string | null) {
  const [page, setPage] = useState<WikiPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    getWikiPage(slug)
      .then(setPage)
      .catch(e => setError(toApiError(e)))
      .finally(() => setLoading(false))
  }, [slug])

  return { page, loading, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useWiki.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useWiki.ts frontend/src/hooks/__tests__/useWiki.test.ts
git commit -m "feat(frontend): useWiki hooks expose ApiError"
```

---

### Task 20: Update `useIngest` — ApiError

**Files:**
- Modify: `frontend/src/hooks/useIngest.ts`
- Create: `frontend/src/hooks/__tests__/useIngest.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/__tests__/useIngest.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useIngest } from '../useIngest'
import { ApiError } from '../../lib/api'

beforeEach(() => vi.restoreAllMocks())

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

describe('useIngest', () => {
  it('exposes ApiError when upload fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'VALIDATION_ERROR', message: 'bad file', request_id: null }, false, 422),
    ))
    const { result } = renderHook(() => useIngest())

    await act(async () => {
      await result.current.upload(new File(['x'], 'x.md'))
    })

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError))
    expect(result.current.error?.code).toBe('VALIDATION_ERROR')
    expect(result.current.job).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useIngest.test.ts`
Expected: FAIL — `error` not exposed; upload throws.

- [ ] **Step 3: Rewrite `useIngest`**

Replace `frontend/src/hooks/useIngest.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, ingestFile, getIngestJob } from '../lib/api'
import type { IngestJob } from '../lib/types'

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError({ code: 'INTERNAL_ERROR', message: 'Upload failed.', requestId: null, status: 0 })
}

export function useIngest() {
  const [job, setJob] = useState<IngestJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setError(null)
    setJob(null)
    stopPolling()
    try {
      const newJob = await ingestFile(file)
      setJob(newJob)

      pollRef.current = setInterval(async () => {
        try {
          const updated = await getIngestJob(newJob.job_id)
          setJob(updated)
          if (updated.status === 'done' || updated.status === 'failed') {
            stopPolling()
          }
        } catch (e: unknown) {
          setError(toApiError(e))
          stopPolling()
        }
      }, 1500)
    } catch (e: unknown) {
      setError(toApiError(e))
    } finally {
      setUploading(false)
    }
  }, [stopPolling])

  useEffect(() => stopPolling, [stopPolling])

  return { job, uploading, upload, error }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/hooks/__tests__/useIngest.test.ts`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useIngest.ts frontend/src/hooks/__tests__/useIngest.test.ts
git commit -m "feat(frontend): useIngest exposes ApiError"
```

---

### Task 21: Update pages to render `<ErrorBanner>`

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`
- Modify: `frontend/src/pages/WikiPage.tsx`
- Modify: `frontend/src/pages/IngestPage.tsx`

- [ ] **Step 1: Update ChatPage**

Replace `frontend/src/pages/ChatPage.tsx`:

```tsx
import { useRef, useEffect } from 'react'
import { ChatMessage } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'
import { ErrorBanner } from '../components/ErrorBanner'
import { useChat } from '../hooks/useChat'

export function ChatPage() {
  const { messages, streaming, sendMessage, error } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-border-cream">
        <h1 className="font-serif text-xl font-medium text-near-black leading-tight">
          Ask the knowledge base
        </h1>
        <p className="text-xs text-stone-gray font-sans mt-0.5">Powered by LLM Wiki</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
        {messages.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-stone-gray font-sans text-sm text-center max-w-xs">
              Ask me anything about your team's documentation, processes, or architecture.
            </p>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {streaming && (
          <div className="text-stone-gray text-xs font-sans animate-pulse">Thinking…</div>
        )}
        {error && <ErrorBanner error={error} />}
        <div ref={bottomRef} />
      </div>

      <div className="px-6 py-4 border-t border-border-cream bg-ivory">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update WikiPage**

Replace `frontend/src/pages/WikiPage.tsx`:

```tsx
import { useParams, Link } from 'react-router-dom'
import { useWikiPages, useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'
import { ErrorBanner } from '../components/ErrorBanner'

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { pages, loading: listLoading, error: listError } = useWikiPages()
  const { page, loading: pageLoading, error: pageError } = useWikiPage(slug ?? null)

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-border-cream py-4 overflow-y-auto flex-shrink-0">
        <p className="px-3 pb-2 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
          All Pages
        </p>
        {listLoading && <p className="px-3 text-xs text-stone-gray font-sans">Loading…</p>}
        {listError && (
          <div className="px-3">
            <ErrorBanner error={listError} />
          </div>
        )}
        {pages.map(s => (
          <Link
            key={s}
            to={`/wiki/${s}`}
            className={`block px-3 py-1.5 text-sm font-sans truncate ${
              s === slug
                ? 'bg-warm-sand text-near-black font-medium'
                : 'text-olive-gray hover:bg-border-cream'
            }`}
          >
            {s}
          </Link>
        ))}
        {!listLoading && !listError && pages.length === 0 && (
          <p className="px-3 text-xs text-stone-gray font-sans">No pages yet.</p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!slug && !pageError && (
          <p className="text-stone-gray font-sans text-sm">Select a page from the list.</p>
        )}
        {pageLoading && <p className="text-stone-gray font-sans text-sm">Loading…</p>}
        {pageError && <ErrorBanner error={pageError} />}
        {page && !pageError && <WikiPageViewer content={page.content} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update IngestPage**

Replace `frontend/src/pages/IngestPage.tsx`:

```tsx
import { IngestDropzone } from '../components/IngestDropzone'
import { ErrorBanner } from '../components/ErrorBanner'
import { useIngest } from '../hooks/useIngest'

export function IngestPage() {
  const { job, uploading, upload, error } = useIngest()

  return (
    <div className="px-8 py-8 max-w-xl">
      <h1 className="font-serif text-xl font-medium text-near-black mb-1">Add Document</h1>
      <p className="text-sm text-stone-gray font-sans mb-6">
        Upload a <code className="bg-parchment px-1 rounded text-near-black">.md</code> file.
        The AI will compile it into the wiki automatically.
      </p>
      {error && (
        <div className="mb-4">
          <ErrorBanner error={error} />
        </div>
      )}
      <IngestDropzone onDrop={upload} job={job} uploading={uploading} />
    </div>
  )
}
```

- [ ] **Step 4: Run full frontend suite**

Run: `cd frontend && pnpm test`
Expected: all tests pass.

- [ ] **Step 5: Run lint**

Run: `cd frontend && pnpm lint`
Expected: clean.

- [ ] **Step 6: Run build**

Run: `cd frontend && pnpm build`
Expected: clean tsc + vite build.

- [ ] **Step 7: Smoke-test end-to-end**

In two terminals:

```bash
# terminal 1
cd backend && .venv/bin/uvicorn kb.main:app --reload --port 8000

# terminal 2
cd frontend && pnpm dev
```

Open `http://localhost:5173`. Expected:
1. Briefly see "Signing in…", then the chat page loads.
2. Network tab shows `GET /api/auth/session` → `204` with `Set-Cookie: kb_session=...; HttpOnly; SameSite=Lax`.
3. Navigate to `/wiki` — list loads.
4. Navigate to `/ingest` — drop a markdown file; job polls to completion.
5. Every request has an `X-Request-ID` response header.
6. Trigger an error (e.g. stop the backend, click around) — `<ErrorBanner>` shows the message and reference id instead of a raw stack.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx frontend/src/pages/WikiPage.tsx frontend/src/pages/IngestPage.tsx
git commit -m "feat(frontend): pages surface errors via ErrorBanner"
```

---

## Final verification

- [ ] **Step 1: Full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all pass.

- [ ] **Step 2: Full frontend suite**

Run: `cd frontend && pnpm test`
Expected: all pass.

- [ ] **Step 3: Frontend build + lint**

Run: `cd frontend && pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 4: Manual smoke test**

Run `pnpm dev` from repo root; verify session bootstrap, cookie set, all three pages work, and an induced error renders through `<ErrorBanner>` (e.g. kill the backend mid-session and click around).

- [ ] **Step 5: Final commit if anything lingering**

```bash
git status
# if clean, nothing to do
```

---

## Cross-references

- Spec: `docs/superpowers/specs/2026-04-17-mvp-hardening-design.md`
- YAGNI decisions recorded in the spec's final table — consult before adding features that touch auth, error codes, or logging.

