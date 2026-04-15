# Knowledge Base AI Agent — Design Spec

**Date:** 2026-04-16  
**Status:** Approved

---

## Overview

A team knowledge base powered by Karpathy's LLM Wiki pattern. Instead of traditional RAG (vector embeddings + similarity search), the system uses an LLM agent to compile raw source documents into a structured, interlinked markdown wiki, then query that wiki to answer questions. The product has two parts: a Python backend and a React chatbox frontend.

---

## 1. Architecture

### Approach: Monorepo, filesystem-first wiki

One repository containing two top-level packages:

```
team-knowledge-base/
  backend/       # FastAPI application
  frontend/      # React + Vite application
  docs/          # Design specs and documentation
```

The wiki is stored as plain `.md` files on disk — inspectable, editable, and version-controllable without a database.

### Why this approach

- Stays true to Karpathy's design intent (wiki is just markdown you can read and edit directly)
- No database to maintain for MVP scale
- Scale-B upgrade (BM25 search) is purely additive — no migration of existing wiki files
- Simple enough for a small team to operate without dedicated infrastructure

---

## 2. LLM Wiki Pattern

Based on Andrej Karpathy's [llm-wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

### Filesystem layout

```
backend/knowledge/
  raw/              # Immutable source documents (user-uploaded .md files)
  wiki/
    index.md        # Content catalog — LLM updates on every ingest
    log.md          # Append-only ingest/query/lint history
    pages/          # One .md file per concept, entity, or topic
  schema/
    SCHEMA.md       # Wiki conventions, page templates, agent instructions
```

### Three operations

**Ingest:** When a raw `.md` file is added, the compile agent reads it alongside relevant existing wiki pages, then: writes/updates `pages/*.md`, updates `index.md`, appends an entry to `log.md`. A single source may touch 5–15 wiki pages.

**Query:** The query agent reads `index.md` to identify relevant pages, reads those pages, then streams a synthesized answer with citations back to the caller via SSE.

**Lint:** Periodic health check that identifies orphan pages (no inbound links), contradictions between pages, and stale claims. Runs on demand.

### Scale path

| Scale | Docs | Retrieval method |
|-------|------|-----------------|
| MVP | ≤ 200 | LLM reads full `index.md`, selects pages |
| Scale-B | 200–1000 | Add BM25 layer (`whoosh` or `tantivy-py`) over `wiki/pages/` — no wiki file changes required |

---

## 3. Backend

### Stack

- **Framework:** FastAPI
- **LLM abstraction:** LiteLLM (model-agnostic — Claude API and Ollama at launch, open to more)
- **Async jobs:** FastAPI `BackgroundTasks` for compile jobs
- **Python version:** 3.11+
- **Package manager:** uv or pip with `pyproject.toml`

### API endpoints

```
POST /api/ingest              Upload a .md file → triggers async compile job
GET  /api/ingest/{job_id}     Poll compile job status (pending | running | done | failed)
GET  /api/wiki                List wiki pages from index.md
GET  /api/wiki/{slug}         Read a single wiki page
POST /api/chat                SSE stream — query agent answers from wiki
POST /api/lint                Trigger lint pass (orphans, contradictions)
```

### Agents

**CompileAgent** — called after ingest:
1. Read raw source document
2. Read `index.md` and relevant existing `pages/*.md`
3. Write/update wiki pages (creates new pages, appends to existing ones, adds backlinks)
4. Update `index.md`
5. Append to `log.md`

**QueryAgent** — called per chat request:
1. Read `index.md`
2. Select relevant page slugs
3. Read those pages
4. Stream answer with citation metadata (source page slugs)

Both agents use LiteLLM — model is configurable via environment variable (`LLM_MODEL`, e.g. `claude-sonnet-4-6` or `ollama/llama3`).

---

## 4. Frontend

### Stack

- **Framework:** React 18
- **Build tool:** Vite
- **Package manager:** pnpm
- **Styling:** Tailwind CSS with custom theme from `DESIGN.md` tokens
- **Language:** TypeScript

### Directory structure

```
frontend/
  tailwind.config.ts        # Custom Tailwind theme (DESIGN.md tokens)
  vite.config.ts
  package.json
  src/
    styles/
      globals.css           # Tailwind directives + custom global CSS
    components/
      ChatMessage.tsx       # Single message bubble with citation tags
      ChatInput.tsx         # Input bar with send button
      Sidebar.tsx           # Recent chats + wiki navigation
      WikiPageViewer.tsx    # Rendered markdown wiki page
      IngestDropzone.tsx    # Drag-and-drop .md upload
    pages/
      ChatPage.tsx          # Main Q&A view
      WikiPage.tsx          # Browse and read compiled wiki
      IngestPage.tsx        # Upload documents + job status
    hooks/
      useChat.ts            # SSE streaming hook
      useWiki.ts            # Wiki list + page fetch
      useIngest.ts          # Upload + poll job status
```

### Design system

All visual tokens from `DESIGN.md` are encoded as a custom Tailwind theme in `tailwind.config.ts`:

- **Colors:** Parchment (`#f5f4ed`), Terracotta (`#c96442`), Anthropic Near Black (`#141413`), Olive Gray (`#5e5d59`), all warm neutrals
- **Typography:** Georgia (serif fallback for Anthropic Serif), system-ui (sans fallback for Anthropic Sans)
- **Border radius scale:** 4px → 8px → 12px → 16px → 32px
- **Shadows:** Ring-based (`0px 0px 0px 1px`) and whisper soft (`rgba(0,0,0,0.05) 0px 4px 24px`)

### UI layout

Three pages accessible from the top nav:

**Chat (default):** Left sidebar (recent conversations + wiki links) + right chat area. User messages in dark (`#141413`) bubbles, AI responses in ivory (`#faf9f5`) bubbles with citation tags. Input bar pinned to bottom. Answers stream in via SSE.

**Wiki:** Browse the compiled wiki. Lists all pages from `index.md`. Clicking a page renders it as markdown.

**Ingest:** Drag-and-drop zone for `.md` files. Shows compile job status (pending → running → done).

---

## 5. Data flow (end-to-end)

```
User uploads .md
  → POST /api/ingest
  → BackgroundTask: CompileAgent reads raw doc + wiki
  → Writes/updates wiki/pages/*.md, index.md, log.md
  → Job status: done

User sends chat message
  → POST /api/chat (SSE)
  → QueryAgent reads index.md → selects pages → reads pages
  → Streams answer with citation slugs
  → Frontend renders streamed tokens + citation tags
```

---

## 6. Out of scope (MVP)

- Authentication / multi-user sessions
- PDF, URL, or Notion ingestion (Markdown only for MVP)
- BM25/vector search (added at Scale-B)
- Lint scheduled runs (manual trigger only)
- Deployment / Docker / CI

---

## 7. Open questions (resolved)

| Question | Decision |
|----------|----------|
| Python framework | FastAPI |
| LLM provider | LiteLLM (Claude API + Ollama, open to more) |
| Wiki storage | Filesystem (plain .md) |
| Frontend styling | Tailwind CSS with DESIGN.md custom theme |
| Ingestion formats (MVP) | Markdown only |
| Scale target | MVP ≤200 docs; designed for 200–1000 |
