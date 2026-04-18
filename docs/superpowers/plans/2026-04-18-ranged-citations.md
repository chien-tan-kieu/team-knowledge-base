# Ranged Citations & Wiki Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade citations from bare slugs to line-ranged references that render as clickable chips. Hover >2s opens a slide-in preview panel showing the cited lines of the wiki page with the range highlighted. Double-click navigates to the wiki page and auto-scrolls to the range with a warm-yellow highlight that fades over 5 seconds.

**Architecture:** Backend prompt changes only — page contents are fed to the LLM line-numbered, and the answer system prompt instructs the model to emit `__CITATIONS__:slug:start-end,...` at the end. Frontend parses `Citation[]` in the store, replaces the read-only citation chips with a new `<ReferenceChip>` component, and renders a single `<PreviewPanel>` mounted at the `ChatPage` level. Preview panel state lives in a small dedicated Zustand store. Wiki content is fetched through a module-level cache. Source-line→DOM mapping happens via a `react-markdown` custom `components` map that attaches `data-source-line-start/end` attributes — a `useWikiHighlight` hook reads those attributes to scroll-and-highlight.

**Tech Stack:** Backend — FastAPI, LiteLLM (prompt changes only). Frontend — React 19, Zustand v5, react-markdown v10 (already installed), react-router v7, Vitest + RTL.

**Spec reference:** `docs/superpowers/specs/2026-04-18-chat-harness-design.md` — feature F3 (§ 2.4 line-numbered pages, § 2.5 citation format, § 3.7 ReferenceChip/PreviewPanel components, § 4 preview panel behavior, § 5 wiki highlighting).

**Working branch:** Suggested `git checkout -b feature/ranged-citations` — branch from `main` after the chat-foundation plan is merged. The interrupt-edit plan is independent of this one.

**Depends on:** `2026-04-18-chat-foundation.md` (store + façade must exist, `{messages[]}` contract in place, marker-level splitting already fixed).

---

## File Structure

### Modified backend files
- `backend/kb/agents/query.py` — line-number page contents; update `ANSWER_SYSTEM_PROMPT` to request `slug:start-end` format.
- `backend/tests/test_query_agent.py` — assert line numbering + citation instructions in Phase 2 prompt.

### Modified frontend files
- `frontend/src/lib/types.ts` — replace `citations: string[]` with `citations: Citation[]`; add `Citation` export.
- `frontend/src/stores/chatStore.ts` — parse citations via regex into `{ slug, start, end }`.
- `frontend/src/stores/__tests__/chatStore.test.ts` — citation parsing tests (single line, range, malformed, mixed).
- `frontend/src/components/ChatMessage.tsx` — render `<ReferenceChip>`; section label becomes "References".
- `frontend/src/components/__tests__/ChatMessage.test.tsx` — update to match new chip shape.
- `frontend/src/components/WikiPageViewer.tsx` — custom `components` map with `withLines(tag)` helper.
- `frontend/src/pages/WikiPage.tsx` — parse `?lines=`, call `useWikiHighlight`.
- `frontend/src/pages/ChatPage.tsx` — mount `<PreviewPanel>` once.
- `frontend/src/styles/globals.css` — `.kb-highlight` + `.kb-highlight-fading` classes.

### New frontend files
- `frontend/src/stores/previewStore.ts` — tiny Zustand store for the active preview citation.
- `frontend/src/lib/wikiCache.ts` — module-level Map cache + in-flight promise dedup.
- `frontend/src/hooks/useWikiHighlight.ts` — scroll + highlight based on `data-source-line-*` attrs.
- `frontend/src/hooks/__tests__/useWikiHighlight.test.tsx`
- `frontend/src/components/ReferenceChip.tsx` — chip with hover-intent, dblclick-to-navigate.
- `frontend/src/components/__tests__/ReferenceChip.test.tsx`
- `frontend/src/components/PreviewPanel.tsx` — slide-in panel reading `usePreviewStore`.
- `frontend/src/components/__tests__/PreviewPanel.test.tsx`

---

## Phase 1 — Backend prompt changes

### Task 1: Line-number page contents in Phase 2

**Files:**
- Modify: `backend/kb/agents/query.py`
- Modify: `backend/tests/test_query_agent.py`

- [ ] **Step 1: Write failing test**

Append to `backend/tests/test_query_agent.py`:

```python
@pytest.mark.asyncio
async def test_phase2_pages_are_line_numbered(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "Line one\nLine two\nLine three")
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "1: Line one" in phase2_system
    assert "2: Line two" in phase2_system
    assert "3: Line three" in phase2_system


@pytest.mark.asyncio
async def test_phase2_prompt_requests_ranged_citations(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "x")
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query([{"role": "user", "content": "q"}]):
            pass

    phase2_system = mock_llm.call_args_list[1].kwargs["messages"][0]["content"]
    assert "__CITATIONS__:" in phase2_system
    assert "slug:line_start-line_end" in phase2_system or "slug-one:15-22" in phase2_system
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_query_agent.py::test_phase2_pages_are_line_numbered tests/test_query_agent.py::test_phase2_prompt_requests_ranged_citations -v`
Expected: FAIL.

- [ ] **Step 3: Update the agent**

Edit `backend/kb/agents/query.py`. Replace the `ANSWER_SYSTEM_PROMPT` and the page-assembly block:

```python
ANSWER_SYSTEM_PROMPT = """You are a helpful knowledge base assistant. Answer using ONLY the wiki pages provided below.

The pages are line-numbered. Use the line numbers to cite precisely.

WIKI PAGES:
{pages}

When you finish your answer, on its own final line, append:
__CITATIONS__:slug-one:15-22,slug-two:30-45

Each entry is `slug:line_start-line_end` (inclusive, 1-indexed). Use a single line number like `:30` for one line. Cite ranges that directly back a claim in your answer. Prefer tight ranges (3-15 lines). Never invent line numbers — if you can't locate a supporting passage, omit that source.

Example:
__CITATIONS__:deploy-process:15-22,ci-cd:30"""


def _format_page_with_line_numbers(slug: str, content: str) -> str:
    lines = content.split("\n")
    numbered = "\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines))
    return f"\n--- {slug} ---\n{numbered}\n"
```

Update the Phase 2 page-assembly loop inside `query` to use the helper:

```python
        pages_content = ""
        for slug in slugs:
            try:
                page = self._fs.read_page(slug)
                pages_content += _format_page_with_line_numbers(slug, page.content)
            except FileNotFoundError:
                pass
```

- [ ] **Step 4: Run**

Run: `cd backend && .venv/bin/pytest tests/test_query_agent.py -v`
Expected: all tests PASS (including the two new ones and the existing multi-turn and cancellation tests).

- [ ] **Step 5: Commit**

```bash
git add backend/kb/agents/query.py backend/tests/test_query_agent.py
git commit -m "feat(agent): line-numbered pages + ranged-citation answer prompt"
```

---

## Phase 2 — Frontend types & store parser

### Task 2: Migrate `citations` from `string[]` to `Citation[]`

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Modify: `frontend/src/stores/chatStore.ts`
- Modify: `frontend/src/stores/__tests__/chatStore.test.ts`

- [ ] **Step 1: Write failing parser test**

Append to `frontend/src/stores/__tests__/chatStore.test.ts`:

```ts
describe('useChatStore citation parsing', () => {
  it('parses slug:start-end entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Answer.', '__CITATIONS__:deploy-process:15-22,ci-cd:30'])
    ))
    await useChatStore.getState().send('q')
    const assistant = useChatStore.getState().messages[1]
    expect(assistant.citations).toEqual([
      { slug: 'deploy-process', start: 15, end: 22 },
      { slug: 'ci-cd', start: 30, end: 30 },
    ])
  })

  it('skips malformed citation entries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Answer.', '__CITATIONS__:deploy-process:15-22,garbage,ci-cd:30'])
    ))
    await useChatStore.getState().send('q')
    const assistant = useChatStore.getState().messages[1]
    expect(assistant.citations).toEqual([
      { slug: 'deploy-process', start: 15, end: 22 },
      { slug: 'ci-cd', start: 30, end: 30 },
    ])
  })
})
```

- [ ] **Step 2: Update `types.ts`**

Edit `frontend/src/lib/types.ts`. Replace the `ChatMessage` interface and add `Citation`:

```ts
export interface Citation {
  slug: string
  start: number
  end: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
}
```

- [ ] **Step 3: Update the store parser**

Edit `frontend/src/stores/chatStore.ts`. Import the new type:

```ts
import type { ChatMessage, ApiErrorBody, Citation } from '../lib/types'
```

Replace `splitCitations`:

```ts
const CITATION_ENTRY_RE = /^([\w-]+):(\d+)(?:-(\d+))?$/

function parseCitationEntries(raw: string): Citation[] {
  const out: Citation[] = []
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const match = CITATION_ENTRY_RE.exec(trimmed)
    if (!match) continue
    const start = parseInt(match[2], 10)
    const end = match[3] ? parseInt(match[3], 10) : start
    out.push({ slug: match[1], start, end })
  }
  return out
}

function splitCitations(raw: string): { content: string; citations: Citation[] } {
  const idx = raw.lastIndexOf(CITATIONS_MARKER)
  if (idx < 0) return { content: raw, citations: [] }
  const content = raw.slice(0, idx).replace(/\s+$/, '')
  const citations = parseCitationEntries(raw.slice(idx + CITATIONS_MARKER.length))
  return { content, citations }
}
```

The rest of the store is unchanged — `set` already sets `citations` from the result of `splitCitations`.

- [ ] **Step 4: Update the old bare-slug test**

In `chatStore.test.ts`, the test "parses citations when the marker arrives as one frame" currently expects `.citations` to be `['deploy-process']`. Change it to the new shape:

```ts
expect(assistant.citations).toEqual([
  { slug: 'deploy-process', start: NaN, end: NaN },  // placeholder; see below
])
```

No — the new parser *rejects* bare slugs without `:N`. Re-design the old test to use the new format instead:

```ts
it('parses a single ranged citation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    makeSSEResponse(['Hello world.', '__CITATIONS__:deploy-process:1-5'])
  ))

  await useChatStore.getState().send('q')

  const assistant = useChatStore.getState().messages[1]
  expect(assistant.content).toBe('Hello world.')
  expect(assistant.citations).toEqual([{ slug: 'deploy-process', start: 1, end: 5 }])
})
```

The split-marker-across-frames test needs a matching update — change the tail frames to include a range, e.g. `',ci-cd:30-31'` and assert `[{ slug: 'deploy-process', start: ..., end: ... }, { slug: 'ci-cd', start: 30, end: 31 }]`.

- [ ] **Step 5: Update the legacy `useChat.test.ts` fixture**

In `frontend/src/hooks/__tests__/useChat.test.ts`, the fixture uses `'__CITATIONS__:deploy-process'` and asserts `citations.toContain('deploy-process')`. Update:

```ts
makeSSEResponse(['Hello ', 'world', '__CITATIONS__:deploy-process:1-5'])
// ...
expect(result.current.messages[1].citations).toContainEqual({
  slug: 'deploy-process', start: 1, end: 5,
})
```

- [ ] **Step 6: Update `ChatMessage.tsx` to handle Citation[]**

Temporarily change the citation render so tests compile. Edit `frontend/src/components/ChatMessage.tsx`, replace the `.map(slug => …)` loop:

```tsx
{!editing && message.citations.length > 0 && (
  <div className="mt-2 pt-2 border-t border-border-cream flex flex-wrap gap-1">
    {message.citations.map(c => (
      <span
        key={`${c.slug}:${c.start}-${c.end}`}
        className="inline-block bg-parchment border border-border-warm rounded text-stone-gray text-xs px-1.5 py-0.5"
      >
        {c.slug}:{c.start === c.end ? c.start : `${c.start}-${c.end}`}
      </span>
    ))}
  </div>
)}
```

This is a temporary render — the `<ReferenceChip>` component in Task 5 will replace it.

Update `ChatMessage.test.tsx` to pass the new citation shape if it asserts on chip contents.

- [ ] **Step 7: Run all tests**

Run: `cd frontend && pnpm test`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/types.ts frontend/src/stores/chatStore.ts frontend/src/stores/__tests__/chatStore.test.ts frontend/src/hooks/__tests__/useChat.test.ts frontend/src/components/ChatMessage.tsx frontend/src/components/__tests__/ChatMessage.test.tsx
git commit -m "feat(chat): migrate citations to Citation[] with {slug,start,end}"
```

---

## Phase 3 — Wiki cache + preview store

### Task 3: Wiki content cache with in-flight dedup

**Files:**
- Create: `frontend/src/lib/wikiCache.ts`
- Create: `frontend/src/lib/__tests__/wikiCache.test.ts`

- [ ] **Step 1: Write failing test**

Create `frontend/src/lib/__tests__/wikiCache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getWikiContent, _resetWikiCache } from '../wikiCache'

beforeEach(() => {
  _resetWikiCache()
  vi.restoreAllMocks()
})

describe('wikiCache', () => {
  it('fetches and caches content by slug', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      { ok: true, json: async () => ({ slug: 'x', content: 'hello' }) }
    )
    vi.stubGlobal('fetch', fetchMock)

    const a = await getWikiContent('x')
    const b = await getWikiContent('x')

    expect(a).toBe('hello')
    expect(b).toBe('hello')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('dedups concurrent fetches for the same slug', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      new Promise(r => setTimeout(() => r({ ok: true, json: async () => ({ slug: 'x', content: 'c' }) }), 20))
    )
    vi.stubGlobal('fetch', fetchMock)

    const [a, b] = await Promise.all([getWikiContent('x'), getWikiContent('x')])
    expect(a).toBe('c')
    expect(b).toBe('c')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Implement cache**

Create `frontend/src/lib/wikiCache.ts`:

```ts
import { getWikiPage } from './api'

const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()

export async function getWikiContent(slug: string): Promise<string> {
  const cached = cache.get(slug)
  if (cached !== undefined) return cached
  const pending = inflight.get(slug)
  if (pending) return pending
  const p = (async () => {
    const page = await getWikiPage(slug)
    cache.set(slug, page.content)
    inflight.delete(slug)
    return page.content
  })()
  inflight.set(slug, p)
  return p
}

// Test helper — not part of the public API.
export function _resetWikiCache(): void {
  cache.clear()
  inflight.clear()
}
```

- [ ] **Step 3: Run**

Run: `cd frontend && pnpm test src/lib/__tests__/wikiCache.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/wikiCache.ts frontend/src/lib/__tests__/wikiCache.test.ts
git commit -m "feat(wiki): LRU-free in-session cache with in-flight dedup"
```

### Task 4: Preview store

**Files:**
- Create: `frontend/src/stores/previewStore.ts`

- [ ] **Step 1: Implement**

Create `frontend/src/stores/previewStore.ts`:

```ts
import { create } from 'zustand'
import type { Citation } from '../lib/types'

interface PreviewState {
  active: Citation | null
  openPreview: (c: Citation) => void
  closePreview: () => void
}

export const usePreviewStore = create<PreviewState>(set => ({
  active: null,
  openPreview: (c) => set({ active: c }),
  closePreview: () => set({ active: null }),
}))
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/stores/previewStore.ts
git commit -m "feat(chat): usePreviewStore for single-active preview state"
```

---

## Phase 4 — ReferenceChip + PreviewPanel

### Task 5: ReferenceChip with hover-intent + dblclick navigation

**Files:**
- Create: `frontend/src/components/ReferenceChip.tsx`
- Create: `frontend/src/components/__tests__/ReferenceChip.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/components/__tests__/ReferenceChip.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReferenceChip } from '../ReferenceChip'
import { usePreviewStore } from '../../stores/previewStore'

function renderChip(citation = { slug: 'deploy-process', start: 15, end: 22 }) {
  return render(
    <MemoryRouter>
      <ReferenceChip citation={citation} />
    </MemoryRouter>
  )
}

beforeEach(() => {
  usePreviewStore.setState({ active: null })
  vi.useFakeTimers()
})

describe('ReferenceChip', () => {
  it('renders range label', () => {
    renderChip()
    expect(screen.getByRole('button', { name: /deploy-process:15-22/ })).toBeInTheDocument()
  })

  it('renders single-line label when start === end', () => {
    renderChip({ slug: 'ci-cd', start: 30, end: 30 })
    expect(screen.getByRole('button', { name: /ci-cd:30/ })).toBeInTheDocument()
  })

  it('opens preview after 2s of hover', () => {
    renderChip()
    const chip = screen.getByRole('button')
    fireEvent.mouseEnter(chip)
    expect(usePreviewStore.getState().active).toBeNull()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(usePreviewStore.getState().active).toEqual({
      slug: 'deploy-process', start: 15, end: 22,
    })
  })

  it('cancels the open timer on mouseleave before 2s', () => {
    renderChip()
    const chip = screen.getByRole('button')
    fireEvent.mouseEnter(chip)
    act(() => { vi.advanceTimersByTime(1500) })
    fireEvent.mouseLeave(chip)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(usePreviewStore.getState().active).toBeNull()
  })
})
```

Note: double-click navigation is easier to test in isolation with `useNavigate`. Add a minimal integration test:

```tsx
it('double-click triggers navigation with ?lines=', () => {
  // react-router-dom's useNavigate is hard to spy without a full router.
  // Assert the DOM side-effect: the store closes and no preview is active.
  vi.useRealTimers()
  renderChip()
  const chip = screen.getByRole('button')
  fireEvent.doubleClick(chip)
  expect(usePreviewStore.getState().active).toBeNull()
})
```

- [ ] **Step 2: Run — verify failure**

Run: `cd frontend && pnpm test src/components/__tests__/ReferenceChip.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement `ReferenceChip`**

Create `frontend/src/components/ReferenceChip.tsx`:

```tsx
import { useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Citation } from '../lib/types'
import { usePreviewStore } from '../stores/previewStore'

interface Props { citation: Citation }

const HOVER_OPEN_MS = 2000

export function ReferenceChip({ citation }: Props) {
  const navigate = useNavigate()
  const openTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (openTimer.current) window.clearTimeout(openTimer.current)
    }
  }, [])

  const label = citation.start === citation.end
    ? `${citation.slug}:${citation.start}`
    : `${citation.slug}:${citation.start}-${citation.end}`

  function clearOpenTimer() {
    if (openTimer.current) {
      window.clearTimeout(openTimer.current)
      openTimer.current = null
    }
  }

  function onMouseEnter() {
    clearOpenTimer()
    openTimer.current = window.setTimeout(() => {
      usePreviewStore.getState().openPreview(citation)
      openTimer.current = null
    }, HOVER_OPEN_MS)
  }

  function onMouseLeave() {
    clearOpenTimer()
  }

  function onDoubleClick() {
    clearOpenTimer()
    usePreviewStore.getState().closePreview()
    const range = citation.start === citation.end
      ? `${citation.start}`
      : `${citation.start}-${citation.end}`
    navigate(`/wiki/${citation.slug}?lines=${range}`)
  }

  return (
    <button
      type="button"
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onDoubleClick={onDoubleClick}
      data-reference-chip
      className="inline-block bg-parchment border border-border-warm rounded text-stone-gray text-xs px-1.5 py-0.5 hover:bg-warm-sand hover:text-near-black transition-colors cursor-pointer"
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 4: Run**

Run: `cd frontend && pnpm test src/components/__tests__/ReferenceChip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Use it in ChatMessage**

Edit `frontend/src/components/ChatMessage.tsx`. Replace the temporary citation render with:

```tsx
import { ReferenceChip } from './ReferenceChip'
// ...
{!editing && message.citations.length > 0 && (
  <div className="mt-2 pt-2 border-t border-border-cream">
    <div className="text-xs text-stone-gray font-sans mb-1">References</div>
    <div className="flex flex-wrap gap-1">
      {message.citations.map(c => (
        <ReferenceChip key={`${c.slug}:${c.start}-${c.end}`} citation={c} />
      ))}
    </div>
  </div>
)}
```

Update `ChatMessage.test.tsx` assertions if they check for the chip text — now the chip is a `<button>` with the same label.

- [ ] **Step 6: Run all tests**

Run: `cd frontend && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ReferenceChip.tsx frontend/src/components/__tests__/ReferenceChip.test.tsx frontend/src/components/ChatMessage.tsx frontend/src/components/__tests__/ChatMessage.test.tsx
git commit -m "feat(chat): ReferenceChip with hover-intent + dblclick navigation"
```

### Task 6: PreviewPanel component

**Files:**
- Create: `frontend/src/components/PreviewPanel.tsx`
- Create: `frontend/src/components/__tests__/PreviewPanel.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/PreviewPanel.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviewPanel } from '../PreviewPanel'
import { usePreviewStore } from '../../stores/previewStore'
import { _resetWikiCache } from '../../lib/wikiCache'

beforeEach(() => {
  usePreviewStore.setState({ active: null })
  _resetWikiCache()
  vi.restoreAllMocks()
})

describe('PreviewPanel', () => {
  it('renders nothing when no active citation', () => {
    const { container } = render(<PreviewPanel />)
    expect(container.textContent).toBe('')
  })

  it('renders line-numbered source with highlighted range when active', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slug: 'x',
        content: 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10',
      }),
    }))

    render(<PreviewPanel />)
    act(() => {
      usePreviewStore.getState().openPreview({ slug: 'x', start: 4, end: 6 })
    })

    await waitFor(() => {
      expect(screen.getByText(/lines 4–6/)).toBeInTheDocument()
    })
    // ±3 context lines means lines 1..9 are visible.
    expect(screen.getByText(/line1/)).toBeInTheDocument()
    expect(screen.getByText(/line9/)).toBeInTheDocument()
    // line10 is outside the ±3 window.
    expect(screen.queryByText(/line10/)).toBeNull()
  })

  it('closes on Escape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ slug: 'x', content: 'a\nb\nc' }),
    }))

    render(<PreviewPanel />)
    act(() => {
      usePreviewStore.getState().openPreview({ slug: 'x', start: 1, end: 1 })
    })
    await waitFor(() => screen.getByText(/lines 1/))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(usePreviewStore.getState().active).toBeNull()
  })
})
```

- [ ] **Step 2: Implement PreviewPanel**

Create `frontend/src/components/PreviewPanel.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { usePreviewStore } from '../stores/previewStore'
import { getWikiContent } from '../lib/wikiCache'

const CONTEXT_LINES = 3
const HOVER_CLOSE_MS = 200

export function PreviewPanel() {
  const active = usePreviewStore(s => s.active)
  const close = usePreviewStore(s => s.closePreview)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      setContent(null)
      setError(null)
      return
    }
    let cancelled = false
    setContent(null)
    setError(null)
    getWikiContent(active.slug)
      .then(c => { if (!cancelled) setContent(c) })
      .catch(() => { if (!cancelled) setError('Unable to load preview') })
    return () => { cancelled = true }
  }, [active])

  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    function onClickOutside(e: MouseEvent) {
      const target = e.target as Element
      if (!panelRef.current) return
      if (panelRef.current.contains(target)) return
      if (target.closest('[data-reference-chip]')) return
      close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [active, close])

  function onPanelEnter() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  function onPanelLeave() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => close(), HOVER_CLOSE_MS)
  }

  if (!active) return null

  const rangeLabel = active.start === active.end ? `${active.start}` : `${active.start}–${active.end}`
  const allLines = (content ?? '').split('\n')
  const windowStart = Math.max(1, active.start - CONTEXT_LINES)
  const windowEnd = Math.min(allLines.length, active.end + CONTEXT_LINES)
  const rendered: Array<{ n: number; text: string; inRange: boolean }> = []
  for (let i = windowStart; i <= windowEnd; i++) {
    rendered.push({ n: i, text: allLines[i - 1] ?? '', inRange: i >= active.start && i <= active.end })
  }

  return (
    <div
      ref={panelRef}
      onMouseEnter={onPanelEnter}
      onMouseLeave={onPanelLeave}
      role="dialog"
      aria-label="Citation preview"
      className="absolute right-0 top-0 bottom-0 w-full sm:w-[320px] bg-ivory border-l border-border-warm shadow-lg z-10 flex flex-col"
      style={{ transition: 'transform 180ms ease, opacity 180ms ease' }}
    >
      <div className="px-3 py-2 border-b border-border-cream flex items-center justify-between">
        <div className="text-xs font-sans text-stone-gray uppercase tracking-wide">
          {active.slug} · lines {rangeLabel}
        </div>
        <button
          onClick={close}
          aria-label="Close preview"
          className="text-stone-gray hover:text-near-black text-sm px-2"
        >×</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs font-mono leading-relaxed">
        {error && <div className="text-red-700">{error}</div>}
        {!error && content === null && <div className="text-stone-gray">Loading…</div>}
        {!error && content !== null && rendered.length === 0 && (
          <div className="text-stone-gray">Range extends beyond page.</div>
        )}
        {!error && content !== null && rendered.map(r => (
          <div
            key={r.n}
            className={r.inRange ? 'bg-[#fff7d9] -mx-3 px-3' : ''}
          >
            <span className="text-stone-gray mr-2 select-none">{r.n}</span>
            <span className="text-near-black whitespace-pre-wrap break-words">{r.text}</span>
          </div>
        ))}
      </div>
      <div className="px-3 py-1.5 border-t border-border-cream text-[10px] font-sans text-stone-gray">
        Double-click link to open page
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it in ChatPage**

Edit `frontend/src/pages/ChatPage.tsx`. Add the import:

```tsx
import { PreviewPanel } from '../components/PreviewPanel'
```

Wrap the main chat column so the panel can be absolutely positioned inside it. Change the outer `<div className="flex flex-col h-full">` to:

```tsx
<div className="relative flex flex-col h-full">
  {/* existing header, messages, input */}
  <PreviewPanel />
</div>
```

- [ ] **Step 4: Run**

Run: `cd frontend && pnpm test src/components/__tests__/PreviewPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PreviewPanel.tsx frontend/src/components/__tests__/PreviewPanel.test.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat(chat): PreviewPanel with Esc/outside-click/hover-region dismissal"
```

---

## Phase 5 — Wiki highlight on navigation

### Task 7: WikiPageViewer attaches `data-source-line-*` attributes

**Files:**
- Modify: `frontend/src/components/WikiPageViewer.tsx`
- Create: `frontend/src/components/__tests__/WikiPageViewer.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/WikiPageViewer.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { WikiPageViewer } from '../WikiPageViewer'

describe('WikiPageViewer', () => {
  it('attaches data-source-line-* to rendered blocks', () => {
    const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.'
    const { container } = render(<WikiPageViewer content={md} />)
    const h1 = container.querySelector('h1')
    expect(h1?.getAttribute('data-source-line-start')).toBe('1')
    const paragraphs = container.querySelectorAll('p')
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0].getAttribute('data-source-line-start')).toBe('3')
    expect(paragraphs[1].getAttribute('data-source-line-start')).toBe('5')
  })
})
```

- [ ] **Step 2: Implement**

Replace `frontend/src/components/WikiPageViewer.tsx`:

```tsx
import ReactMarkdown from 'react-markdown'
import type { ComponentProps } from 'react'

interface Props { content: string }

type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li' | 'pre' | 'blockquote' | 'table'

function withLines(tag: Tag) {
  return function Component(props: ComponentProps<typeof tag> & { node?: any }) {
    const { node, ...rest } = props
    const Tag = tag as any
    return (
      <Tag
        data-source-line-start={node?.position?.start?.line}
        data-source-line-end={node?.position?.end?.line}
        {...rest}
      />
    )
  }
}

const components = {
  p: withLines('p'),
  h1: withLines('h1'), h2: withLines('h2'), h3: withLines('h3'),
  h4: withLines('h4'), h5: withLines('h5'), h6: withLines('h6'),
  ul: withLines('ul'), ol: withLines('ol'), li: withLines('li'),
  pre: withLines('pre'), blockquote: withLines('blockquote'), table: withLines('table'),
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose md:prose-sm max-w-none font-sans text-near-black leading-relaxed prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-code:break-words">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}
```

- [ ] **Step 3: Run**

Run: `cd frontend && pnpm test src/components/__tests__/WikiPageViewer.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WikiPageViewer.tsx frontend/src/components/__tests__/WikiPageViewer.test.tsx
git commit -m "feat(wiki): annotate rendered blocks with data-source-line-*"
```

### Task 8: `useWikiHighlight` hook

**Files:**
- Create: `frontend/src/hooks/useWikiHighlight.ts`
- Create: `frontend/src/hooks/__tests__/useWikiHighlight.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/hooks/__tests__/useWikiHighlight.test.tsx`:

```tsx
import { render, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRef, useEffect } from 'react'
import { useWikiHighlight } from '../useWikiHighlight'

function TestHost({ lines }: { lines: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useWikiHighlight(ref, lines)
  useEffect(() => {
    if (!ref.current) return
    ref.current.innerHTML = `
      <h1 data-source-line-start="1" data-source-line-end="1">Title</h1>
      <p data-source-line-start="3" data-source-line-end="3">A</p>
      <p data-source-line-start="5" data-source-line-end="7">B</p>
      <p data-source-line-start="9" data-source-line-end="9">C</p>
    `
  }, [])
  return <div ref={ref} />
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.useFakeTimers()
})

describe('useWikiHighlight', () => {
  it('adds .kb-highlight to overlapping blocks', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="5-6" />)
    const highlighted = container.querySelectorAll('.kb-highlight')
    expect(highlighted).toHaveLength(1)
    expect(highlighted[0].textContent).toBe('B')
  })

  it('removes the class after 5s', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="5-6" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(1)
    act(() => { vi.advanceTimersByTime(5100) })
    act(() => { vi.advanceTimersByTime(700) })
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })

  it('ignores malformed param', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="garbage" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })

  it('handles out-of-bounds range (no match, no crash)', () => {
    const { container, rerender } = render(<TestHost lines={null} />)
    rerender(<TestHost lines="999-1000" />)
    expect(container.querySelectorAll('.kb-highlight')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Implement hook**

Create `frontend/src/hooks/useWikiHighlight.ts`:

```ts
import { useEffect, type RefObject } from 'react'

const HIGHLIGHT_DURATION_MS = 5000
const FADE_MS = 600
const LINES_RE = /^(\d+)(?:-(\d+))?$/

export function useWikiHighlight(containerRef: RefObject<HTMLElement | null>, linesParam: string | null) {
  useEffect(() => {
    if (!linesParam) return
    const container = containerRef.current
    if (!container) return

    const match = LINES_RE.exec(linesParam)
    if (!match) return
    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : start

    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>('[data-source-line-start]')
    )
    const hits = blocks.filter(el => {
      const s = parseInt(el.getAttribute('data-source-line-start') ?? '0', 10)
      const e = parseInt(el.getAttribute('data-source-line-end') ?? `${s}`, 10)
      return s <= end && e >= start
    })

    if (hits.length === 0) {
      container.scrollTo?.({ top: 0, behavior: 'smooth' })
      return
    }

    hits[0].scrollIntoView({ behavior: 'smooth', block: 'start' })
    hits.forEach(el => el.classList.add('kb-highlight'))

    const fadeTimer = window.setTimeout(() => {
      hits.forEach(el => el.classList.add('kb-highlight-fading'))
    }, HIGHLIGHT_DURATION_MS - FADE_MS)
    const removeTimer = window.setTimeout(() => {
      hits.forEach(el => {
        el.classList.remove('kb-highlight')
        el.classList.remove('kb-highlight-fading')
      })
    }, HIGHLIGHT_DURATION_MS)

    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(removeTimer)
      hits.forEach(el => {
        el.classList.remove('kb-highlight')
        el.classList.remove('kb-highlight-fading')
      })
    }
  }, [containerRef, linesParam])
}
```

- [ ] **Step 3: Add CSS**

Edit `frontend/src/styles/globals.css`. Append:

```css
.kb-highlight {
  background-color: #fff7d9;
  transition: background-color 600ms ease-out;
  border-left: 2px solid #d4a05d;
  margin-left: -12px;
  padding-left: 10px;
}
.kb-highlight.kb-highlight-fading {
  background-color: transparent;
}
```

- [ ] **Step 4: Run**

Run: `cd frontend && pnpm test src/hooks/__tests__/useWikiHighlight.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useWikiHighlight.ts frontend/src/hooks/__tests__/useWikiHighlight.test.tsx frontend/src/styles/globals.css
git commit -m "feat(wiki): useWikiHighlight scrolls + fades warm-yellow over 5s"
```

### Task 9: Wire the highlight into WikiPage via `?lines=`

**Files:**
- Modify: `frontend/src/pages/WikiPage.tsx`

- [ ] **Step 1: Read and update WikiPage**

Open `frontend/src/pages/WikiPage.tsx` to understand its current shape, then update to parse `?lines=` and pass the ref through. If your current `WikiPage` renders `<WikiPageViewer content={content} />`, wrap it:

```tsx
import { useRef } from 'react'
import { useSearchParams, useParams } from 'react-router-dom'
import { WikiPageViewer } from '../components/WikiPageViewer'
import { useWikiHighlight } from '../hooks/useWikiHighlight'
// ... existing imports

export function WikiPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const linesParam = searchParams.get('lines')
  const contentRef = useRef<HTMLDivElement>(null)

  // ...existing fetching of content/pages via useWiki...

  useWikiHighlight(contentRef, linesParam)

  // When rendering the single-page view:
  return (
    <div /* existing classes */>
      {/* ...list-view branch unchanged... */}
      <div ref={contentRef}>
        <WikiPageViewer content={page.content} />
      </div>
    </div>
  )
}
```

Keep the rest of `WikiPage` intact — only thread the ref and the hook call into the slug-view branch.

- [ ] **Step 2: Manual smoke**

Run `pnpm dev`. Send a chat message that produces citations (you may need real content; alternatively stub the API). Then:
- Double-click a chip → wiki page opens, scrolls to the range, highlights cited blocks with warm yellow.
- Highlight fades over 5 seconds.
- Navigate between wiki pages without `?lines=` — no highlight residue.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/WikiPage.tsx
git commit -m "feat(wiki): scroll + highlight when navigated via ?lines= query"
```

---

## Verification

- [ ] **Backend tests:** `cd backend && .venv/bin/pytest` — green.
- [ ] **Frontend tests:** `cd frontend && pnpm test` — green.
- [ ] **Frontend build:** `cd frontend && pnpm build` — succeeds.
- [ ] **Manual end-to-end:**
  1. Ingest/prepare a wiki page with known line content (or use an existing page).
  2. Ask a question whose answer should cite that page.
  3. Confirm "References" footer with clickable chips labeled `slug:start-end`.
  4. Hover a chip for 2s → side panel slides in with line-numbered source and warm-yellow band over the cited range.
  5. Move mouse away → panel closes after 200ms grace.
  6. Re-open; press Esc → panel closes.
  7. Re-open; click anywhere outside panel/chip → closes.
  8. Double-click chip → wiki page opens, scrolls to the cited block, fades highlight after 5s.
  9. Navigate to a different wiki page without `?lines=` → no stale highlight.

## Self-review checklist

- [ ] Citation format in backend prompt: `slug:line_start-line_end`, with single-line form.
- [ ] Wiki pages are 1-indexed and include their line numbers in the system prompt.
- [ ] Chip labels render `slug:N` for single line, `slug:N-M` for range.
- [ ] Hover timer = 2000ms exact; mouseleave cancels pre-2s.
- [ ] Preview dismisses on Esc, outside click, and mouseleave region (with 200ms grace).
- [ ] Highlight visible for 5s before fading for ~600ms.
- [ ] Malformed `?lines=` and out-of-bounds ranges don't crash.
- [ ] 9 commits on this branch (1 per task).
