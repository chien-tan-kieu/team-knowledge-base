# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

An LLM-powered team knowledge base — a React SPA backed by a Python API (proxied at `/api/*`). Users can chat with their documentation (with citations), browse the wiki, and ingest new markdown files.

## Development Commands

All commands run from the `frontend/` subdirectory:

```bash
cd frontend

npm run dev          # Start Vite dev server (proxies /api/* → http://localhost:8000)
npm run build        # Type-check + production build
npm run lint         # ESLint
npm run test         # Vitest (single run)
npm run test:watch   # Vitest in watch mode
npm run preview      # Preview production build
```

To run a single test file:
```bash
npx vitest run src/hooks/__tests__/useChat.test.ts
```

## Architecture

### Stack
- React 19 + React Router 7, TypeScript (strict), Vite 8, Tailwind CSS 4
- Testing: Vitest + React Testing Library + @testing-library/jest-dom

### Layout & Routing
`App.tsx` defines a shell with a fixed header and left `<Sidebar>`. Routes:

| Path | Page |
|------|------|
| `/` | `ChatPage` — SSE-streamed chat with citations |
| `/wiki` | `WikiPage` — wiki page list |
| `/wiki/:slug` | `WikiPage` — renders a single page via `WikiPageViewer` |
| `/ingest` | `IngestPage` — drag-and-drop markdown upload with job polling |

### Data Flow
Three custom hooks own all async logic:

- **`useChat`** (`src/hooks/useChat.ts`) — POSTs to `/api/chat`, reads an SSE stream, parses tokens and citation markers into `Message[]`
- **`useWiki`** (`src/hooks/useWiki.ts`) — GETs `/api/wiki` and `/api/wiki/:slug`; renders markdown via `react-markdown`
- **`useIngest`** (`src/hooks/useIngest.ts`) — POSTs FormData to `/api/ingest`, then polls `/api/ingest/:jobId` for status

API surface is centralized in `src/lib/api.ts`; shared types live in `src/lib/types.ts`.

### Styling
Tailwind 4 with a custom warm palette — `parchment`, `ivory`, `warm-sand`, `border-cream`, `stone-gray`, `olive-gray`, `near-black`. Global styles are in `src/styles/globals.css`.
