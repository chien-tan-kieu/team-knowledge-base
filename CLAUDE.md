# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An LLM-powered team knowledge base. A React SPA talks to a FastAPI backend at `/api/*` (Vite dev server proxies to `http://localhost:8000`). Users chat with their docs (SSE-streamed answers with citations), browse a wiki, and ingest new markdown files that an LLM compiles into structured wiki pages.

The repo is a **pnpm workspace monorepo** with two packages: `backend/` (Python) and `frontend/` (Node).

## Development Commands

From the repo root:

```bash
pnpm install             # install frontend deps + register both workspaces
pnpm dev                 # run backend + frontend in parallel (pnpm -r --parallel run dev)
pnpm dev:backend         # just the backend (uvicorn on :8000)
pnpm dev:frontend        # just the frontend (Vite on :5173)
```

The root `dev` script uses **pnpm's native recursive runner** (`pnpm -r --parallel run dev`). Backend is a workspace because `backend/package.json` exposes a `dev` script that shells out to uvicorn; Python deps still live in `backend/pyproject.toml` and are managed by `uv` inside `backend/.venv`.

### Frontend

```bash
cd frontend
pnpm build          # tsc -b && vite build
pnpm lint           # ESLint
pnpm test           # Vitest (single run)
pnpm test:watch     # Vitest watch
npx vitest run src/hooks/__tests__/useChat.test.ts   # single file
```

### Backend

```bash
cd backend
.venv/bin/pytest                                     # full suite (asyncio_mode=auto)
.venv/bin/pytest tests/test_query_agent.py           # single file
.venv/bin/pytest tests/test_query_agent.py::test_x   # single test
```

The backend venv is seeded with `uv sync --extra dev` (produces `.venv/` with FastAPI, LiteLLM, pytest, etc.). Configuration comes from `backend/.env` — copy `backend/.env.example` and set `LLM_MODEL` (any LiteLLM-compatible model id) and optionally `KNOWLEDGE_DIR`.

## Architecture

### Backend (`backend/kb/`)

FastAPI app assembled in `kb/main.py::create_app`. Four routers mounted under `/api/*`:

| Route | Handler | Purpose |
|-------|---------|---------|
| `POST /api/ingest` | `api/ingest.py` | Accepts an uploaded markdown file, creates a job, kicks off background compilation |
| `GET /api/ingest/{job_id}` | `api/ingest.py` | Polls ingest job status |
| `GET /api/wiki` | `api/wiki.py` | List wiki page slugs |
| `GET /api/wiki/{slug}` | `api/wiki.py` | Read a single page |
| `POST /api/chat` | `api/chat.py` | SSE stream of tokens + citation marker |
| `POST /api/lint` | `api/lint.py` | Orphan-page detection |

The code is organized around the **Karpathy LLM Wiki pattern**, a three-stage pipeline over a plain-markdown filesystem rooted at `KNOWLEDGE_DIR` (default `backend/knowledge/`):

```
knowledge/
  raw/        ← uploaded originals (source of truth for ingest)
  wiki/
    index.md  ← table of contents maintained by the compiler
    log.md    ← append-only audit of ingest operations
    pages/    ← compiled wiki pages, one markdown file per slug
  schema/
    SCHEMA.md ← authoring conventions the compiler must follow
```

All disk I/O goes through `kb/wiki/fs.py::WikiFS` — the one chokepoint that reads/writes raw, pages, index, log, and schema. Auto-creates missing directories in its constructor.

Three LLM agents live in `kb/agents/`, each a small class that calls `litellm.(a)completion` with a prompt template:

- **`CompileAgent`** (`compile.py`) — ingest-time. Reads `SCHEMA.md` + current index + relevant existing pages + the raw document, prompts the model, then parses output delimited by `=== PAGE: <slug> ===`, `=== INDEX ===`, `=== LOG_ENTRY ===` blocks and writes them back through `WikiFS`.
- **`QueryAgent`** (`query.py`) — query-time, **two-phase**. Phase 1: non-streaming completion selects up to 5 relevant slugs from the index. Phase 2: streams a grounded answer and appends `__CITATIONS__:<slugs>` on its own final line. The SSE endpoint splits the stream: regular tokens become `data:` events; the citations line becomes a `citations` event.
- **`LintAgent`** (`lint.py`) — flags wiki pages that aren't referenced from the index (orphans).

Jobs are tracked in `kb/jobs/store.py::InMemoryJobStore` (no database — process-local, non-persistent). Dependency injection uses `@lru_cache` singletons in `kb/api/deps.py` so `WikiFS` and the job store are shared across requests.

### Frontend (`frontend/src/`)

React 19 + React Router 7, TypeScript strict, Vite 8, Tailwind 4, Vitest + RTL.

`App.tsx` is a shell (fixed header + left `<Sidebar>`). Four routes:

| Path | Page |
|------|------|
| `/` | `ChatPage` — SSE-streamed chat with citations |
| `/wiki` | `WikiPage` — wiki list |
| `/wiki/:slug` | `WikiPage` — single page via `WikiPageViewer` (`react-markdown`) |
| `/ingest` | `IngestPage` — drag-and-drop upload with job polling |

All async logic lives in three hooks; pages are thin wrappers around them:

- **`useChat`** (`hooks/useChat.ts`) — POSTs `/api/chat`, reads the SSE stream, parses tokens and citation markers into `Message[]`.
- **`useWiki`** (`hooks/useWiki.ts`) — GETs `/api/wiki` and `/api/wiki/:slug`.
- **`useIngest`** (`hooks/useIngest.ts`) — POSTs FormData to `/api/ingest`, then polls `/api/ingest/:jobId` until the job leaves the queued/running state.

API surface is centralized in `lib/api.ts`; shared TS types in `lib/types.ts`. Vite dev server proxies `/api` → `http://localhost:8000` (see `vite.config.ts`). Backend CORS allows only `http://localhost:5173`.

### Styling

Tailwind 4 with a **warm, parchment-toned palette**: `parchment`, `ivory`, `warm-sand`, `border-cream`, `stone-gray`, `olive-gray`, `near-black`. Global styles in `src/styles/globals.css`. The design language (fonts, motion, tone) is documented in `DESIGN.md` at the repo root — consult it before making visual changes.

## Notes

- Plans and specs live under `docs/superpowers/`. Treat them as historical implementation records, not active tickets.
- `.worktrees/` is used by the superpowers workflow for isolated branches; both `.superpowers/` and `.worktrees/` are gitignored.
- `.venv/`, `__pycache__/`, `knowledge/raw/*`, and `knowledge/wiki/pages/*` are ignored in `backend/.gitignore` (the `.gitkeep` files preserve the dir structure).
