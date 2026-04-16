# MVP hardening: logging, errors, auth, UI error display

**Status:** approved for planning
**Date:** 2026-04-17
**Author:** brainstormed with Claude Code

## Goal

The MVP works end-to-end. This spec covers three orthogonal-but-contract-coupled cleanups that take it from "functionally complete" to "presentable":

1. Graceful application logging and a global exception handler on the backend.
2. Authenticated UI ↔ API communication via an httpOnly cookie-based JWT (origin-bound session bootstrap — no credentials shipped in the SPA).
3. A structured error-response contract that the UI surfaces cleanly through a single `<ErrorBanner>` component, replacing the current raw-error strings.

These pieces couple through **one shared contract**: the JSON shape returned for every error. Backend emits it, frontend types it, UI displays its `message` field.

## Non-goals

See the explicit YAGNI list at the end of this doc. Short version: no per-user login, no refresh tokens, no log shipping, no rate limiting, no CSRF tokens beyond `SameSite=Lax`.

## Current state (what exists today)

- `backend/kb/main.py::create_app` mounts four routers under `/api/*`. CORS is locked to `http://localhost:5173`. No auth, no logging, no global exception handlers.
- Each route raises `HTTPException(..., detail="…")` ad hoc.
- `backend/kb/api/ingest.py` background task swallows exceptions into `job.error = str(exc)` — leaks internals.
- `frontend/src/lib/api.ts::fetchJson` throws `new Error('API error 500: /api/foo')`. No structured shape; pages render the raw string.
- `backend/kb/config.py` uses `pydantic-settings` with an `.env` file. Currently exposes `llm_model` and `knowledge_dir` only.

## Design

### Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  FastAPI app (kb/main.py::create_app)                       │
│                                                             │
│  ① logging.py       setup_logging() called at import        │
│  ② middleware.py    RequestContextMiddleware                │
│                      - generates request_id (ULID)          │
│                      - binds to contextvar + response header│
│                      - logs request/response                │
│  ③ errors.py        global exception handlers               │
│                      - HTTPException  → flat error JSON     │
│                      - RequestValidationError → 422 + shape │
│                      - Exception (catch-all) → 500 + shape  │
│  ④ auth/            session + JWT                           │
│      routes.py      GET /api/auth/session                   │
│      jwt.py         encode/decode                           │
│      middleware.py  requires valid cookie on /api/* except  │
│                     /api/auth/session                       │
└─────────────────────────────────────────────────────────────┘
           ▲
           │ httpOnly cookie: kb_session (JWT, SameSite=Lax)
           │
┌─────────────────────────────────────────────────────────────┐
│  Frontend (SPA)                                             │
│  App.tsx:  await ensureSession() before children render     │
│  lib/api.ts: fetchJson parses flat error → ApiError throw   │
│              fetch uses credentials: 'include'              │
│  components/ErrorBanner.tsx: renders ApiError.message       │
│  hooks/*: expose error: ApiError | null                     │
└─────────────────────────────────────────────────────────────┘
```

### Shared contract — error response shape

Flat top-level JSON, always returned with an accurate HTTP status code:

```json
{
  "code": "NOT_FOUND",
  "message": "Job not found.",
  "request_id": "01HN6YV8XTR9A1TQ2M3X7E1B4C"
}
```

- `code`: stable `SCREAMING_SNAKE_CASE` identifier. Frontend may branch on it (e.g. `UNAUTHENTICATED` → re-bootstrap session).
- `message`: human-readable, safe to show in the UI. Never contains stack traces, file paths, or raw exception `str()`. For `INTERNAL_ERROR` it is a generic string: `"Something went wrong. Reference: <request_id>."`.
- `request_id`: ULID, matches the same id in the log line and the `X-Request-ID` response header. Users can paste it back to us for debugging.

Starting code set (kept deliberately small):

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Request body/params failed validation |
| `UNAUTHENTICATED` | 401 | Missing/invalid/expired `kb_session` cookie |
| `NOT_FOUND` | 404 | Resource not found (generic — no domain-specific variants yet) |
| `UPSTREAM_LLM_ERROR` | 502 | `litellm` raised |
| `INTERNAL_ERROR` | 500 | Catch-all for unexpected exceptions |

### ① Logging — `backend/kb/logging.py` (new)

- Stdlib `logging` with a `JsonFormatter` emitting one JSON object per line: `{ts, level, logger, message, request_id?, ...extra}`.
- `setup_logging()` configures the root logger once, reads `LOG_LEVEL` from env (default `INFO`), replaces default uvicorn handlers so everything flows through one formatter.
- Each module uses `logger = logging.getLogger(__name__)`.
- `request_id` is injected automatically via a `contextvars.ContextVar` set by the middleware; a `logging.Filter` reads it and attaches it to every record. No manual `extra={}` at call sites.

### ② Request context middleware — `backend/kb/middleware.py` (new)

`RequestContextMiddleware`:
- Generate `request_id` (ULID — sortable, 26 chars).
- Bind to contextvar.
- Set response header `X-Request-ID`.
- Log `{event: "request.start", method, path}` and `{event: "request.end", status, duration_ms}`.
- On uncaught exception: log `{event: "request.error", ...}` with `exc_info=True`, then re-raise so the exception handler can produce the response.

### ③ Global exception handlers — `backend/kb/errors.py` (new)

Handlers registered on the app:

- `HTTPException` → maps `status_code` to a `code` (`404→NOT_FOUND`, `401→UNAUTHENTICATED`, etc.); `message` from `detail` (callers must keep `detail` safe to show).
- `RequestValidationError` → `422`, `VALIDATION_ERROR`, message summarizes the first error (e.g. `"question: must not be empty"`).
- `Exception` (catch-all) → `500`, `INTERNAL_ERROR`, generic message `"Something went wrong. Reference: <request_id>."`. Full traceback logged, never returned to the client.
- LLM errors: agents wrap `litellm` calls and raise a `LLMUpstreamError` → handler returns `502` `UPSTREAM_LLM_ERROR` with message `"The language model is currently unavailable."`.

Existing route code clean-up:
- Remove ad-hoc `HTTPException(..., detail="…")` strings that leak internals; replace with the code-mapped handlers and safe user-facing messages.
- `backend/kb/api/ingest.py` background task currently does `store.update_job(job_id, status=FAILED, error=str(exc))`. Change to: log the exception with full `exc_info`, store a generic `"Ingest failed."` on the job (or a mapped user-safe message for known failure modes).

SSE chat errors (`POST /api/chat`): if the generator raises mid-stream, emit a terminal event `event: error\ndata: {flat error json}\n\n` then close. `useChat` handles it as a message-level error without dropping prior tokens.

### ④ Auth — variant B, session bootstrap — `backend/kb/auth/` (new)

**`GET /api/auth/session`** (unauthenticated):
- Validate `Origin` header against `ALLOWED_ORIGINS` (list, from env; defaults to `["http://localhost:5173"]`). Missing or mismatched origin → `401 UNAUTHENTICATED`.
- Mint JWT with claims `{sub: "spa", exp: now + jwt_ttl_seconds, iat: now}`, signed `HS256` with `JWT_SECRET` (env, required — no default).
- Set cookie: `kb_session=<jwt>; HttpOnly; SameSite=Lax; Path=/; Max-Age=<ttl>`. Dev: no `Secure`. Prod: `Secure` (documented in `.env.example`).
- Response: `204 No Content`.

**`AuthMiddleware`** (runs after `RequestContextMiddleware`):
- Bypass list: `/api/auth/session`, `/docs`, `/openapi.json`, `/healthz` (new `GET /healthz` for liveness).
- Else: read `kb_session` cookie, decode/verify JWT. On missing/invalid/expired → raise `HTTPException(401, detail="Session required.")` → handler maps to `UNAUTHENTICATED`.

**Config additions — `backend/kb/config.py`:**

```python
jwt_secret: str                      # required, no default
jwt_ttl_seconds: int = 86400         # 24h
allowed_origins: list[str] = ["http://localhost:5173"]
log_level: str = "INFO"
```

`.env.example` updated; generate-secret instruction (`python -c 'import secrets; print(secrets.token_urlsafe(32))'`) included as a comment.

### ⑤ Frontend API client — `frontend/src/lib/api.ts`

- Add `class ApiError extends Error` with fields `{code: string, message: string, requestId: string | null, status: number}`.
- Rewrite `fetchJson` so every fetch sends `credentials: 'include'`. On `!res.ok`: parse the flat JSON body, throw an `ApiError`. On non-JSON body (rare), throw a synthetic `ApiError` with `code: 'INTERNAL_ERROR'` and `requestId` taken from the `X-Request-ID` header (if present).
- Add `ensureSession()`: `GET /api/auth/session` with `credentials: 'include'`. Memoize the in-flight promise so concurrent callers share one request.

### ⑥ Frontend bootstrap — `frontend/src/App.tsx`

- New `<SessionGate>` wrapper component: calls `ensureSession()` on mount. While pending, renders `<BootstrapLoading/>`. On failure, renders `<ErrorBanner>` with a "Retry" button. On success, renders children.
- Wrap the `<Routes>` subtree so no route or hook fires an API call before the cookie is set.

### ⑦ Frontend error display — `frontend/src/components/ErrorBanner.tsx` (new)

- Props: `error: ApiError | null`, optional `onRetry?: () => void`.
- Renders `error.message` prominently plus `request_id` in small muted text.
- Styled per `DESIGN.md` palette: `warm-sand` background, `near-black` text, subtle border.
- Replaces all ad-hoc error rendering in `ChatPage`, `WikiPage`, `IngestPage`.

Hook updates (`useChat`, `useWiki`, `useIngest`):
- `error: ApiError | null` instead of `Error | null`.
- Internal try/catch narrows `unknown` to `ApiError`; anything else is wrapped into a synthetic `INTERNAL_ERROR`.

## Testing strategy

### Backend (pytest, `asyncio_mode=auto`)

- `tests/test_errors.py`: each handler returns the correct flat shape, code, HTTP status.
- `tests/test_auth.py`:
  - unauthenticated `/api/wiki` → `401 UNAUTHENTICATED` with flat shape;
  - `/api/auth/session` with bad `Origin` → `401`;
  - `/api/auth/session` with good `Origin` → `204` + `Set-Cookie: kb_session=...`;
  - subsequent `/api/wiki` with cookie → `200`;
  - expired JWT → `401`.
- `tests/test_logging.py`: smoke test that `request_id` flows from middleware → log record → `X-Request-ID` response header.

### Frontend (vitest + RTL)

- `lib/api.test.ts`: `fetchJson` parses flat error into `ApiError`; `ensureSession` memoization (two concurrent callers produce one fetch).
- `components/SessionGate.test.tsx`: renders loading → children on success; banner + retry on failure.
- `components/ErrorBanner.test.tsx`: renders `message` and `request_id`.
- Update existing hook tests (`useChat`, `useWiki`, `useIngest`) to assert `ApiError` instead of `Error`.

## Files touched

**New (backend):**
- `kb/logging.py`, `kb/middleware.py`, `kb/errors.py`
- `kb/auth/__init__.py`, `kb/auth/routes.py`, `kb/auth/jwt.py`, `kb/auth/middleware.py`
- `tests/test_errors.py`, `tests/test_auth.py`, `tests/test_logging.py`

**Modified (backend):**
- `kb/main.py` (wire middleware + handlers + auth router)
- `kb/config.py` (+4 fields)
- `kb/api/ingest.py` (drop `str(exc)`, log instead)
- `kb/api/wiki.py`, `kb/api/chat.py` (SSE error event), `kb/api/lint.py`
- `kb/agents/query.py`, `kb/agents/compile.py`, `kb/agents/lint.py` (wrap litellm errors)
- `backend/.env.example`

**New (frontend):**
- `src/components/ErrorBanner.tsx`, `src/components/SessionGate.tsx`, `src/components/BootstrapLoading.tsx`
- related tests

**Modified (frontend):**
- `src/lib/api.ts` (ApiError + ensureSession + `credentials: 'include'`)
- `src/lib/types.ts` (export `ApiError` type)
- `src/App.tsx` (SessionGate wrapper)
- `src/hooks/useChat.ts`, `src/hooks/useWiki.ts`, `src/hooks/useIngest.ts`
- `src/pages/ChatPage.tsx`, `src/pages/WikiPage.tsx`, `src/pages/IngestPage.tsx` (use `<ErrorBanner>`)

## YAGNI / explicit non-goals

Kept here so future features can reference them rather than re-deriving context. Each is a **conscious deferral**, not an oversight — revisit if the stated trigger fires.

| Deferred | Why deferred | Revisit when |
|---|---|---|
| **Refresh-token rotation** | 24h TTL + fresh bootstrap on page load is enough for the current usage pattern. Single-token design keeps auth code minimal. | A tab-idle-for-a-day user hitting a mid-session 401 becomes a real complaint, or we need sessions >24h. |
| **Lazy re-bootstrap on 401** | We chose "bootstrap on mount only" (user's explicit preference). A 401 mid-session requires a page refresh. | The above user complaint fires, or we add long-lived tabs (e.g. embedded widgets). |
| **Per-user identity / login form (variant C)** | Out of scope for the "not wide open" bar we set. Cookie/JWT plumbing is already the shape C needs — it's an additive change later. | Any per-user feature lands: audit logs, per-user drafts, role-based access, sharing. |
| **Log shipping / structured log correlation beyond `request_id`** | Stdout JSON is parseable by any collector the deployer chooses to add. Adding specific shippers now locks us in. | Production deployment picks a log backend (Datadog / Loki / CloudWatch). |
| **Rate limiting** | Trusted network, single-SPA traffic pattern. No public API exposure. | We expose any endpoint outside the allowed origin, or add per-user auth. |
| **CSRF tokens** | `SameSite=Lax` + origin-checked session mint is sufficient for variant B's threat model. | We add endpoints callable cross-site, or move to variant C with long-lived sessions. |
| **Domain-specific error codes** (e.g. `WIKI_PAGE_NOT_FOUND` vs generic `NOT_FOUND`) | Frontend doesn't branch on these yet. Adding codes without a consumer is speculative. | The UI needs to render different treatment per resource type on the same HTTP status. |
| **Log level per logger / dynamic log level** | One `LOG_LEVEL` env var covers every current need. | We hit noisy library logs we want to turn down independently. |
| **Secure cookie in dev** | Dev is http-only; `Secure` would prevent the cookie from being set. Production `.env.example` flips it on. | We add a prod/staging deploy — documented already. |
| **JWT rotation / key rolling** | Single `JWT_SECRET` from env is enough for variant B. | Multi-environment deployments or compliance pressure for key rotation. |
| **Changes to wiki/agent/ingest business logic** | Out of scope. This spec is pure hardening. | A separate feature spec asks for it. |

## Open questions

None at spec-approval time. Any that arise during implementation get surfaced back to the user rather than silently resolved.
