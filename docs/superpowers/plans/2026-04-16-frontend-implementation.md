# Knowledge Base Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a React chatbox UI for the team knowledge base — three pages (Chat, Wiki, Ingest) styled with the Anthropic/Claude design system via Tailwind CSS v4.

**Architecture:** Single-page app with React Router. API client abstracted in `lib/api.ts`. SSE streaming handled via custom hook. Design tokens from `DESIGN.md` configured in `tailwind.config.ts` (JS-based plugins) and `src/styles/globals.css` (CSS `@theme` tokens for Tailwind v4).

**Tech Stack:** React 19.2.0, Vite 8.0.7, Tailwind CSS v4, TypeScript 6.0.2, pnpm, @tailwindcss/vite, react-router-dom, react-markdown, vitest

---

## File Map

```
frontend/
  package.json
  pnpm-lock.yaml
  tsconfig.json
  vite.config.ts               # Includes @tailwindcss/vite plugin
  tailwind.config.ts           # Tailwind plugins (JS-based config)
  index.html
  src/
    main.tsx                   # React root + router
    App.tsx                    # Layout shell + nav + route outlet
    styles/
      globals.css              # @import "tailwindcss" + @theme tokens
    lib/
      types.ts                 # Shared TypeScript interfaces
      api.ts                   # API client (fetch wrappers for all endpoints)
    hooks/
      useChat.ts               # SSE streaming hook → token[]
      useWiki.ts               # Wiki list + single page fetch
      useIngest.ts             # File upload + poll job status
    components/
      ChatMessage.tsx          # Single message bubble + citation tags
      ChatInput.tsx            # Textarea input + send button
      Sidebar.tsx              # Left nav: recent chats + wiki links
      WikiPageViewer.tsx       # Markdown renderer for wiki pages
      IngestDropzone.tsx       # Drag-and-drop .md upload zone
    pages/
      ChatPage.tsx             # Chat layout: sidebar + message list + input
      WikiPage.tsx             # Wiki browser: page list + selected page
      IngestPage.tsx           # Upload UI + job status display
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `frontend/` (via vite scaffold)
- Create: `frontend/vite.config.ts`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/src/styles/globals.css`

- [ ] **Step 1: Scaffold Vite + React + TypeScript project**

```bash
cd /path/to/team-knowledge-base
pnpm create vite frontend --template react-ts
cd frontend
```

- [ ] **Step 2: Install all dependencies**

```bash
pnpm add react-router-dom react-markdown
pnpm add -D tailwindcss @tailwindcss/vite vitest @vitest/ui @testing-library/react @testing-library/user-event jsdom
```

- [ ] **Step 3: Replace `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})
```

- [ ] **Step 4: Create `frontend/tailwind.config.ts`**

```ts
import type { Config } from 'tailwindcss'

// In Tailwind v4, design tokens are configured via CSS @theme in globals.css.
// This file is kept for JS-based plugins and future extensions.
export default {
  plugins: [],
} satisfies Config
```

- [ ] **Step 5: Create `src/styles/globals.css`**

```css
@import "tailwindcss";

@theme {
  /* Colors — from DESIGN.md */
  --color-parchment: #f5f4ed;
  --color-ivory: #faf9f5;
  --color-terracotta: #c96442;
  --color-coral: #d97757;
  --color-near-black: #141413;
  --color-dark-surface: #30302e;
  --color-charcoal-warm: #4d4c48;
  --color-olive-gray: #5e5d59;
  --color-stone-gray: #87867f;
  --color-warm-silver: #b0aea5;
  --color-warm-sand: #e8e6dc;
  --color-border-cream: #f0eee6;
  --color-border-warm: #e8e6dc;
  --color-ring-warm: #d1cfc5;
  --color-focus-blue: #3898ec;
  --color-error-crimson: #b53333;

  /* Typography */
  --font-serif: Georgia, serif;
  --font-sans: system-ui, Arial, sans-serif;
  --font-mono: "Courier New", monospace;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-2xl: 24px;
  --radius-3xl: 32px;

  /* Shadows */
  --shadow-ring: 0px 0px 0px 1px var(--color-ring-warm);
  --shadow-whisper: rgba(0, 0, 0, 0.05) 0px 4px 24px;
}

body {
  background-color: var(--color-parchment);
  color: var(--color-near-black);
  font-family: var(--font-sans);
}
```

- [ ] **Step 6: Create `src/test-setup.ts`**

```ts
import '@testing-library/jest-dom'
```

- [ ] **Step 7: Verify dev server starts**

```bash
pnpm dev
```

Expected: Vite starts on http://localhost:5173 with no errors.

- [ ] **Step 8: Commit**

```bash
cd ..
git add frontend/
git commit -m "feat(frontend): project scaffold — Vite + React 19 + Tailwind v4 + DESIGN.md tokens"
```

---

## Task 2: TypeScript Types

**Files:**
- Create: `frontend/src/lib/types.ts`

- [ ] **Step 1: Create `src/lib/types.ts`**

```ts
export interface WikiPage {
  slug: string
  content: string
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface IngestJob {
  job_id: string
  filename: string
  status: JobStatus
  error: string | null
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: string[]  // wiki page slugs
}

export interface LintResult {
  orphans: string[]
  contradictions: string[]
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/types.ts
git commit -m "feat(frontend): shared TypeScript types"
```

---

## Task 3: API Client

**Files:**
- Create: `frontend/src/lib/api.ts`
- Create: `frontend/src/lib/__tests__/api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/__tests__/api.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getWikiPages, getWikiPage, ingestFile, startChat } from '../api'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('getWikiPages', () => {
  it('fetches page slugs from /api/wiki', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: ['deploy-process', 'onboarding'] }),
    }))
    const pages = await getWikiPages()
    expect(pages).toEqual(['deploy-process', 'onboarding'])
    expect(fetch).toHaveBeenCalledWith('/api/wiki')
  })
})

describe('getWikiPage', () => {
  it('fetches a single wiki page by slug', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slug: 'deploy-process', content: '# Deploy' }),
    }))
    const page = await getWikiPage('deploy-process')
    expect(page.slug).toBe('deploy-process')
    expect(fetch).toHaveBeenCalledWith('/api/wiki/deploy-process')
  })

  it('throws on 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(getWikiPage('missing')).rejects.toThrow()
  })
})

describe('ingestFile', () => {
  it('posts file and returns job_id', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ job_id: 'abc-123', status: 'pending' }),
    }))
    const job = await ingestFile(new File(['# Doc'], 'doc.md'))
    expect(job.job_id).toBe('abc-123')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
pnpm vitest run src/lib/__tests__/api.test.ts
```

Expected: `Cannot find module '../api'`

- [ ] **Step 3: Create `src/lib/api.ts`**

```ts
import type { WikiPage, IngestJob, LintResult } from './types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`)
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
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error(`Chat API error ${res.status}`)
  return res
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/__tests__/api.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/lib/
git commit -m "feat(frontend): API client with typed wrappers for all backend endpoints"
```

---

## Task 4: useWiki and useIngest Hooks

**Files:**
- Create: `frontend/src/hooks/useWiki.ts`
- Create: `frontend/src/hooks/useIngest.ts`

- [ ] **Step 1: Create `src/hooks/useWiki.ts`**

```ts
import { useState, useEffect } from 'react'
import { getWikiPages, getWikiPage } from '../lib/api'
import type { WikiPage } from '../lib/types'

export function useWikiPages() {
  const [pages, setPages] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getWikiPages()
      .then(setPages)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return { pages, loading, error }
}

export function useWikiPage(slug: string | null) {
  const [page, setPage] = useState<WikiPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    setError(null)
    getWikiPage(slug)
      .then(setPage)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [slug])

  return { page, loading, error }
}
```

- [ ] **Step 2: Create `src/hooks/useIngest.ts`**

```ts
import { useState, useCallback, useRef } from 'react'
import { ingestFile, getIngestJob } from '../lib/api'
import type { IngestJob } from '../lib/types'

export function useIngest() {
  const [job, setJob] = useState<IngestJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    stopPolling()
    try {
      const newJob = await ingestFile(file)
      setJob(newJob)

      // Poll until done or failed
      pollRef.current = setInterval(async () => {
        const updated = await getIngestJob(newJob.job_id)
        setJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') {
          stopPolling()
        }
      }, 1500)
    } finally {
      setUploading(false)
    }
  }, [stopPolling])

  return { job, uploading, upload }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/
git commit -m "feat(frontend): useWiki + useIngest hooks"
```

---

## Task 5: useChat Hook (SSE Streaming)

**Files:**
- Create: `frontend/src/hooks/useChat.ts`
- Create: `frontend/src/hooks/__tests__/useChat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/__tests__/useChat.test.ts`:

```ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'

function makeSSEResponse(lines: string[]) {
  const body = lines.map(l => `data: ${l}\n\n`).join('')
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return { ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response
}

beforeEach(() => vi.restoreAllMocks())

describe('useChat', () => {
  it('starts with empty messages', () => {
    const { result } = renderHook(() => useChat())
    expect(result.current.messages).toEqual([])
    expect(result.current.streaming).toBe(false)
  })

  it('adds user message and streams assistant response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Hello ', 'world', '__CITATIONS__:deploy-process'])
    ))

    const { result } = renderHook(() => useChat())

    await act(async () => {
      await result.current.sendMessage('How do I deploy?')
    })

    expect(result.current.messages).toHaveLength(2)
    expect(result.current.messages[0].role).toBe('user')
    expect(result.current.messages[0].content).toBe('How do I deploy?')
    expect(result.current.messages[1].role).toBe('assistant')
    expect(result.current.messages[1].content).toContain('Hello world')
    expect(result.current.messages[1].citations).toContain('deploy-process')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
pnpm vitest run src/hooks/__tests__/useChat.test.ts
```

Expected: `Cannot find module '../useChat'`

- [ ] **Step 3: Create `src/hooks/useChat.ts`**

```ts
import { useState, useCallback } from 'react'
import { startChat } from '../lib/api'
import type { ChatMessage } from '../lib/types'

const CITATIONS_MARKER = '__CITATIONS__:'

function parseToken(token: string, msg: ChatMessage): ChatMessage {
  if (token.includes(CITATIONS_MARKER)) {
    const [text, citationsPart] = token.split(CITATIONS_MARKER)
    const citations = citationsPart.split(',').map(s => s.trim()).filter(Boolean)
    return { ...msg, content: msg.content + text, citations }
  }
  return { ...msg, content: msg.content + token }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)

  const sendMessage = useCallback(async (question: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      citations: [],
    }

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      citations: [],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    try {
      const response = await startChat(question)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const text = decoder.decode(value, { stream: true })
        // SSE lines: "data: <token>\n\n"
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const token = line.slice(6)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last.id !== assistantMsg.id) return prev
            return [...prev.slice(0, -1), parseToken(token, last)]
          })
        }
      }
    } finally {
      setStreaming(false)
    }
  }, [])

  return { messages, streaming, sendMessage }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/hooks/__tests__/useChat.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/hooks/
git commit -m "feat(frontend): useChat hook with SSE streaming and citation parsing"
```

---

## Task 6: ChatMessage Component

**Files:**
- Create: `frontend/src/components/ChatMessage.tsx`
- Create: `frontend/src/components/__tests__/ChatMessage.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/__tests__/ChatMessage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { ChatMessage } from '../ChatMessage'
import type { ChatMessage as ChatMessageType } from '../../lib/types'

const userMsg: ChatMessageType = {
  id: '1', role: 'user', content: 'How do I deploy?', citations: []
}

const assistantMsg: ChatMessageType = {
  id: '2', role: 'assistant', content: 'Run `make deploy`.', citations: ['deploy-process']
}

describe('ChatMessage', () => {
  it('renders user message content', () => {
    render(<ChatMessage message={userMsg} />)
    expect(screen.getByText('How do I deploy?')).toBeInTheDocument()
  })

  it('renders assistant message content', () => {
    render(<ChatMessage message={assistantMsg} />)
    expect(screen.getByText(/make deploy/)).toBeInTheDocument()
  })

  it('renders citation tags for assistant messages', () => {
    render(<ChatMessage message={assistantMsg} />)
    expect(screen.getByText('deploy-process')).toBeInTheDocument()
  })

  it('does not render citations for user messages', () => {
    render(<ChatMessage message={userMsg} />)
    expect(screen.queryByText('deploy-process')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd frontend
pnpm vitest run src/components/__tests__/ChatMessage.test.tsx
```

Expected: `Cannot find module '../ChatMessage'`

- [ ] **Step 3: Create `src/components/ChatMessage.tsx`**

```tsx
import type { ChatMessage as ChatMessageType } from '../lib/types'

interface Props {
  message: ChatMessageType
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium font-sans ${
          isUser
            ? 'bg-warm-sand text-charcoal-warm'
            : 'bg-terracotta text-ivory'
        }`}
      >
        {isUser ? 'U' : 'K'}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-prose rounded-xl px-4 py-3 text-sm leading-relaxed font-sans shadow-whisper ${
          isUser
            ? 'bg-near-black text-ivory rounded-tr-sm'
            : 'bg-ivory border border-border-cream text-near-black rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-cream flex flex-wrap gap-1">
            {message.citations.map(slug => (
              <span
                key={slug}
                className="inline-block bg-parchment border border-border-warm rounded text-stone-gray text-xs px-1.5 py-0.5"
              >
                {slug}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/components/__tests__/ChatMessage.test.tsx
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/components/ChatMessage.tsx frontend/src/components/__tests__/
git commit -m "feat(frontend): ChatMessage component with citation tags"
```

---

## Task 7: ChatInput Component

**Files:**
- Create: `frontend/src/components/ChatInput.tsx`

- [ ] **Step 1: Create `src/components/ChatInput.tsx`**

```tsx
import { useState, type KeyboardEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 items-end bg-ivory border border-border-warm rounded-xl px-4 py-2 shadow-whisper">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your team's knowledge…"
        rows={1}
        disabled={disabled}
        className="flex-1 resize-none bg-transparent text-sm text-near-black placeholder-warm-silver outline-none font-sans leading-relaxed"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="bg-terracotta text-ivory text-sm font-medium font-sans px-4 py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        Send
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ChatInput.tsx
git commit -m "feat(frontend): ChatInput component"
```

---

## Task 8: Sidebar Component

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`

- [ ] **Step 1: Create `src/components/Sidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'
import { useWikiPages } from '../hooks/useWiki'

export function Sidebar() {
  const { pages } = useWikiPages()

  return (
    <aside className="w-55 bg-ivory border-r border-border-cream flex flex-col py-4 gap-1 overflow-y-auto">
      <span className="px-3 py-1 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
        Navigate
      </span>

      <NavLink
        to="/"
        className={({ isActive }) =>
          `mx-1 px-3 py-1.5 rounded-md text-sm font-sans ${
            isActive
              ? 'bg-warm-sand text-near-black font-medium'
              : 'text-olive-gray hover:bg-border-cream'
          }`
        }
      >
        Chat
      </NavLink>

      <NavLink
        to="/ingest"
        className={({ isActive }) =>
          `mx-1 px-3 py-1.5 rounded-md text-sm font-sans ${
            isActive
              ? 'bg-warm-sand text-near-black font-medium'
              : 'text-olive-gray hover:bg-border-cream'
          }`
        }
      >
        + Add Document
      </NavLink>

      {pages.length > 0 && (
        <>
          <span className="px-3 pt-3 pb-1 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
            Wiki
          </span>
          {pages.map(slug => (
            <NavLink
              key={slug}
              to={`/wiki/${slug}`}
              className={({ isActive }) =>
                `mx-1 px-3 py-1.5 rounded-md text-sm font-sans truncate ${
                  isActive
                    ? 'bg-warm-sand text-near-black font-medium'
                    : 'text-olive-gray hover:bg-border-cream'
                }`
              }
            >
              {slug}
            </NavLink>
          ))}
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Sidebar.tsx
git commit -m "feat(frontend): Sidebar with nav links and wiki page list"
```

---

## Task 9: WikiPageViewer and IngestDropzone Components

**Files:**
- Create: `frontend/src/components/WikiPageViewer.tsx`
- Create: `frontend/src/components/IngestDropzone.tsx`

- [ ] **Step 1: Create `src/components/WikiPageViewer.tsx`**

```tsx
import ReactMarkdown from 'react-markdown'

interface Props {
  content: string
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose prose-sm max-w-none font-sans text-near-black leading-relaxed">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/IngestDropzone.tsx`**

```tsx
import { useCallback } from 'react'
import type { IngestJob } from '../lib/types'

interface Props {
  onDrop: (file: File) => void
  job: IngestJob | null
  uploading: boolean
}

const STATUS_LABELS: Record<IngestJob['status'], string> = {
  pending: 'Queued…',
  running: 'Compiling wiki pages…',
  done: 'Done — wiki updated.',
  failed: 'Failed.',
}

const STATUS_COLORS: Record<IngestJob['status'], string> = {
  pending: 'text-stone-gray',
  running: 'text-terracotta',
  done: 'text-near-black',
  failed: 'text-error-crimson',
}

export function IngestDropzone({ onDrop, job, uploading }: Props) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.md')) onDrop(file)
  }, [onDrop])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onDrop(file)
  }, [onDrop])

  return (
    <div className="flex flex-col gap-6">
      <label
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border-warm rounded-xl p-12 cursor-pointer bg-ivory hover:border-terracotta transition-colors"
      >
        <span className="text-4xl">📄</span>
        <span className="text-sm text-olive-gray font-sans text-center">
          Drag a <code className="bg-parchment px-1 rounded text-near-black">.md</code> file here,
          or <span className="text-terracotta underline">click to browse</span>
        </span>
        <input
          type="file"
          accept=".md"
          className="hidden"
          onChange={handleFileInput}
          disabled={uploading}
        />
      </label>

      {job && (
        <div className="bg-ivory border border-border-cream rounded-xl p-4 font-sans text-sm">
          <div className="flex justify-between items-center">
            <span className="text-near-black font-medium">{job.filename}</span>
            <span className={STATUS_COLORS[job.status]}>{STATUS_LABELS[job.status]}</span>
          </div>
          {job.error && (
            <p className="mt-2 text-error-crimson text-xs">{job.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/
git commit -m "feat(frontend): WikiPageViewer + IngestDropzone components"
```

---

## Task 10: ChatPage

**Files:**
- Create: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Create `src/pages/ChatPage.tsx`**

```tsx
import { useRef, useEffect } from 'react'
import { ChatMessage } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'
import { useChat } from '../hooks/useChat'

export function ChatPage() {
  const { messages, streaming, sendMessage } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border-cream">
        <h1 className="font-serif text-xl font-medium text-near-black leading-tight">
          Ask the knowledge base
        </h1>
        <p className="text-xs text-stone-gray font-sans mt-0.5">Powered by LLM Wiki</p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
        {messages.length === 0 && (
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
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border-cream bg-ivory">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat(frontend): ChatPage — full chat UI with streaming"
```

---

## Task 11: WikiPage and IngestPage

**Files:**
- Create: `frontend/src/pages/WikiPage.tsx`
- Create: `frontend/src/pages/IngestPage.tsx`

- [ ] **Step 1: Create `src/pages/WikiPage.tsx`**

```tsx
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useWikiPages, useWikiPage } from '../hooks/useWiki'
import { WikiPageViewer } from '../components/WikiPageViewer'

export function WikiPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { pages, loading: listLoading } = useWikiPages()
  const { page, loading: pageLoading } = useWikiPage(slug ?? null)

  return (
    <div className="flex h-full">
      {/* Page list */}
      <div className="w-48 border-r border-border-cream py-4 overflow-y-auto flex-shrink-0">
        <p className="px-3 pb-2 text-xs font-medium text-stone-gray uppercase tracking-widest font-sans">
          All Pages
        </p>
        {listLoading && <p className="px-3 text-xs text-stone-gray font-sans">Loading…</p>}
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
        {!listLoading && pages.length === 0 && (
          <p className="px-3 text-xs text-stone-gray font-sans">No pages yet.</p>
        )}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {!slug && (
          <p className="text-stone-gray font-sans text-sm">Select a page from the list.</p>
        )}
        {pageLoading && <p className="text-stone-gray font-sans text-sm">Loading…</p>}
        {page && <WikiPageViewer content={page.content} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `src/pages/IngestPage.tsx`**

```tsx
import { IngestDropzone } from '../components/IngestDropzone'
import { useIngest } from '../hooks/useIngest'

export function IngestPage() {
  const { job, uploading, upload } = useIngest()

  return (
    <div className="px-8 py-8 max-w-xl">
      <h1 className="font-serif text-xl font-medium text-near-black mb-1">Add Document</h1>
      <p className="text-sm text-stone-gray font-sans mb-6">
        Upload a <code className="bg-parchment px-1 rounded text-near-black">.md</code> file.
        The AI will compile it into the wiki automatically.
      </p>
      <IngestDropzone onDrop={upload} job={job} uploading={uploading} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/
git commit -m "feat(frontend): WikiPage + IngestPage"
```

---

## Task 12: App Shell and Routing

**Files:**
- Create: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

- [ ] **Step 1: Create `src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { ChatPage } from './pages/ChatPage'
import { WikiPage } from './pages/WikiPage'
import { IngestPage } from './pages/IngestPage'

export function App() {
  return (
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
  )
}
```

- [ ] **Step 2: Replace `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import './styles/globals.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
```

- [ ] **Step 3: Run all tests**

```bash
cd frontend
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 4: Smoke test in browser**

```bash
pnpm dev
```

Open http://localhost:5173. Verify:
- Parchment background renders
- Sidebar shows Chat and Add Document links
- Chat page renders with empty state message
- Nav between Chat / Wiki / Ingest works

- [ ] **Step 5: Commit**

```bash
cd ..
git add frontend/src/App.tsx frontend/src/main.tsx
git commit -m "feat(frontend): App shell with React Router — Chat, Wiki, Ingest pages wired"
```
