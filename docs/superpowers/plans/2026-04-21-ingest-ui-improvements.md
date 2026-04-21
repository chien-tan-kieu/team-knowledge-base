# Ingest UI improvements — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver three connected UI improvements on the Ingest flow — a compile-stage loading animation, cross-route state persistence for in-flight ingests, and a notification system keyed off the bell in `AppHeader`.

**Architecture:** Two new Zustand stores (`ingestStore`, `notificationsStore`) hoist ingest state + polling out of the `useIngest` hook so it survives `IngestPage` unmount. `ingestStore` owns the poll loop and, on terminal status, pushes a notification into `notificationsStore`. A new `<Notifications />` component (bell trigger + dropdown + item) replaces the static bell button in `AppHeader`, owns its own `isOpen` state, and renders items with per-row hover actions.

**Tech Stack:** React 19, TypeScript strict, Zustand, React Router 7, Tailwind 4, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-04-21-ingest-ui-improvements-design.md`

---

## File Structure

**Create**
- `frontend/src/utils/relativeTime.ts` — relative timestamp formatter.
- `frontend/src/utils/__tests__/relativeTime.test.ts`
- `frontend/src/stores/notificationsStore.ts` — Zustand store for the notification list, push/markRead/markAllRead/remove.
- `frontend/src/stores/__tests__/notificationsStore.test.ts`
- `frontend/src/stores/ingestStore.ts` — Zustand store owning `{ job, uploading, error, upload }`, polling, and completion → notification pushes.
- `frontend/src/stores/__tests__/ingestStore.test.ts`
- `frontend/src/components/Notifications/index.tsx` — bell trigger; owns `isOpen`, anchor ref, click-outside/Escape handling.
- `frontend/src/components/Notifications/NotificationsDropdown.tsx` — the panel rendered when open.
- `frontend/src/components/Notifications/NotificationItem.tsx` — single row with hover actions.
- `frontend/src/components/Notifications/__tests__/Notifications.test.tsx`

**Modify**
- `frontend/src/hooks/useIngest.ts` — shrinks to a thin selector over `ingestStore`; preserves `{ job, uploading, upload, error }` surface.
- `frontend/src/components/IngestDropzone.tsx` — adds a shimmer animation on the active-and-not-failed Compile stage bar.
- `frontend/src/components/AppHeader.tsx` — replaces the inline static bell button with `<Notifications />`.

**Leave untouched**
- `frontend/src/pages/IngestPage.tsx` — it already reads from `useIngest()`; its destructure `{ job, uploading, upload }` continues to work.
- `frontend/src/hooks/__tests__/useIngest.test.ts` — the existing test exercises the preserved public surface; it should keep passing as-is.
- `frontend/src/lib/types.ts`, `frontend/src/lib/api.ts` — no backend contract change.

---

## Task 1: `relativeTime` utility

**Files:**
- Create: `frontend/src/utils/relativeTime.ts`
- Test: `frontend/src/utils/__tests__/relativeTime.test.ts`

- [ ] **Step 1.1: Write the failing test**

Create `frontend/src/utils/__tests__/relativeTime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relativeTime'

describe('formatRelativeTime', () => {
  const now = new Date('2026-04-21T12:00:00Z').getTime()

  it('returns "just now" for deltas under 60s', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('just now')
    expect(formatRelativeTime(now, now)).toBe('just now')
  })

  it('returns "Nm ago" between 1 and 59 minutes', () => {
    expect(formatRelativeTime(now - 60_000, now)).toBe('1m ago')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 59 * 60_000, now)).toBe('59m ago')
  })

  it('returns "Nh ago" between 1 and 23 hours', () => {
    expect(formatRelativeTime(now - 60 * 60_000, now)).toBe('1h ago')
    expect(formatRelativeTime(now - 23 * 60 * 60_000, now)).toBe('23h ago')
  })

  it('returns "yesterday" between 24 and 47 hours', () => {
    expect(formatRelativeTime(now - 24 * 60 * 60_000, now)).toBe('yesterday')
    expect(formatRelativeTime(now - 47 * 60 * 60_000, now)).toBe('yesterday')
  })

  it('returns a localized date beyond 48h', () => {
    const ts = now - 5 * 24 * 60 * 60_000
    expect(formatRelativeTime(ts, now)).toBe(new Date(ts).toLocaleDateString())
  })
})
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/utils/__tests__/relativeTime.test.ts`
Expected: FAIL with "Cannot find module '../relativeTime'".

- [ ] **Step 1.3: Implement the utility**

Create `frontend/src/utils/relativeTime.ts`:

```ts
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ts)
  if (delta < MINUTE) return 'just now'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 2 * DAY) return 'yesterday'
  return new Date(ts).toLocaleDateString()
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/utils/__tests__/relativeTime.test.ts`
Expected: PASS — all 5 tests green.

- [ ] **Step 1.5: Commit**

```bash
git add frontend/src/utils/relativeTime.ts frontend/src/utils/__tests__/relativeTime.test.ts
git commit -m "feat(utils): add formatRelativeTime helper"
```

---

## Task 2: `notificationsStore`

**Files:**
- Create: `frontend/src/stores/notificationsStore.ts`
- Test: `frontend/src/stores/__tests__/notificationsStore.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `frontend/src/stores/__tests__/notificationsStore.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { useNotificationsStore, selectUnreadCount } from '../notificationsStore'

beforeEach(() => {
  useNotificationsStore.setState({ items: [] })
})

describe('notificationsStore', () => {
  it('push prepends an item with generated id/createdAt and read=false', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success',
      title: 'Compiled a.md',
      filename: 'a.md',
      jobId: 'job-1',
    })
    const items = useNotificationsStore.getState().items
    expect(items).toHaveLength(1)
    expect(items[0].read).toBe(false)
    expect(items[0].id).toEqual(expect.any(String))
    expect(items[0].createdAt).toEqual(expect.any(Number))
    expect(items[0].kind).toBe('ingest-success')
  })

  it('push prepends newer items above older ones', () => {
    const { push } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'first', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-failure', title: 'second', filename: 'b.md', jobId: '2' })
    const titles = useNotificationsStore.getState().items.map(i => i.title)
    expect(titles).toEqual(['second', 'first'])
  })

  it('caps the list at 50 items, dropping the oldest', () => {
    const { push } = useNotificationsStore.getState()
    for (let i = 0; i < 51; i++) {
      push({ kind: 'ingest-success', title: `n${i}`, filename: 'x.md', jobId: String(i) })
    }
    const items = useNotificationsStore.getState().items
    expect(items).toHaveLength(50)
    expect(items[0].title).toBe('n50')
    expect(items[items.length - 1].title).toBe('n1')
  })

  it('markRead flips one item, markAllRead flips all', () => {
    const { push, markRead, markAllRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    const [second, first] = useNotificationsStore.getState().items
    markRead(second.id)
    expect(useNotificationsStore.getState().items.find(i => i.id === second.id)?.read).toBe(true)
    expect(useNotificationsStore.getState().items.find(i => i.id === first.id)?.read).toBe(false)
    markAllRead()
    expect(useNotificationsStore.getState().items.every(i => i.read)).toBe(true)
  })

  it('markRead toggles: read=true on an unread item, read=false on a read item', () => {
    const { push, markRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    const { id } = useNotificationsStore.getState().items[0]
    markRead(id)
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
    markRead(id)
    expect(useNotificationsStore.getState().items[0].read).toBe(false)
  })

  it('remove deletes by id', () => {
    const { push, remove } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    const { id } = useNotificationsStore.getState().items[0]
    remove(id)
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })

  it('selectUnreadCount returns the count of unread items', () => {
    const { push, markRead } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    expect(selectUnreadCount(useNotificationsStore.getState())).toBe(2)
    markRead(useNotificationsStore.getState().items[0].id)
    expect(selectUnreadCount(useNotificationsStore.getState())).toBe(1)
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stores/__tests__/notificationsStore.test.ts`
Expected: FAIL with "Cannot find module '../notificationsStore'".

- [ ] **Step 2.3: Implement the store**

Create `frontend/src/stores/notificationsStore.ts`:

```ts
import { create } from 'zustand'

export type NotificationKind = 'ingest-success' | 'ingest-failure'

export interface Notification {
  id: string
  kind: NotificationKind
  title: string
  detail?: string
  filename: string
  jobId: string
  createdAt: number
  read: boolean
}

export type PushInput = Omit<Notification, 'id' | 'createdAt' | 'read'>

interface NotificationsState {
  items: Notification[]
  push: (input: PushInput) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
}

const MAX_ITEMS = 50

export const useNotificationsStore = create<NotificationsState>(set => ({
  items: [],
  push: input =>
    set(state => {
      const next: Notification = {
        ...input,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        read: false,
      }
      const merged = [next, ...state.items]
      return { items: merged.length > MAX_ITEMS ? merged.slice(0, MAX_ITEMS) : merged }
    }),
  markRead: id =>
    set(state => ({
      items: state.items.map(i => (i.id === id ? { ...i, read: !i.read } : i)),
    })),
  markAllRead: () =>
    set(state => ({ items: state.items.map(i => ({ ...i, read: true })) })),
  remove: id => set(state => ({ items: state.items.filter(i => i.id !== id) })),
}))

export function selectUnreadCount(state: NotificationsState): number {
  return state.items.reduce((n, i) => (i.read ? n : n + 1), 0)
}
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/stores/__tests__/notificationsStore.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add frontend/src/stores/notificationsStore.ts frontend/src/stores/__tests__/notificationsStore.test.ts
git commit -m "feat(stores): add notificationsStore with push/markRead/remove"
```

---

## Task 3: `ingestStore`

**Files:**
- Create: `frontend/src/stores/ingestStore.ts`
- Test: `frontend/src/stores/__tests__/ingestStore.test.ts`

Notes for the engineer:
- The current `useIngest` polls every 1500ms via `setInterval`. Preserve that cadence.
- Keep the `error: ApiError | null` field on the store surface — callers (and the existing `useIngest.test.ts`) still read it. It is set alongside `job.error` in failure paths.
- Completion must call `useNotificationsStore.getState().push(...)` exactly once per job, then stop polling.

- [ ] **Step 3.1: Write the failing test**

Create `frontend/src/stores/__tests__/ingestStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useIngestStore } from '../ingestStore'
import { useNotificationsStore } from '../notificationsStore'
import { ApiError } from '../../lib/api'

function jsonRes(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    headers: new Headers(),
    json: async () => body,
  } as unknown as Response
}

beforeEach(() => {
  vi.useFakeTimers()
  useIngestStore.setState({ job: null, uploading: false, error: null })
  useNotificationsStore.setState({ items: [] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ingestStore.upload', () => {
  it('sets uploading and stores the returned job', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null })
    ))
    const p = useIngestStore.getState().upload(new File(['x'], 'a.md'))
    expect(useIngestStore.getState().uploading).toBe(true)
    await p
    expect(useIngestStore.getState().uploading).toBe(false)
    expect(useIngestStore.getState().job).toEqual({
      job_id: 'j1', filename: 'a.md', status: 'pending', error: null,
    })
  })

  it('pushes a success notification when polling sees status=done', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'running', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(1500)

    expect(useIngestStore.getState().job?.status).toBe('done')
    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-success')
    expect(notifs[0].filename).toBe('a.md')
    expect(notifs[0].jobId).toBe('j1')
  })

  it('pushes a failure notification when polling sees status=failed', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'failed', error: 'boom' }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)

    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-failure')
    expect(notifs[0].detail).toBe('boom')
  })

  it('fires exactly one notification even if polling continues past terminal status', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[Math.min(i++, responses.length - 1)])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)
    await vi.advanceTimersByTimeAsync(5000)

    expect(useNotificationsStore.getState().items).toHaveLength(1)
  })

  it('treats a poll-time network error as failure', async () => {
    const postRes = jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(postRes)
      .mockRejectedValueOnce(new TypeError('network down'))
    vi.stubGlobal('fetch', fetchMock)

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500)

    expect(useIngestStore.getState().job?.status).toBe('failed')
    expect(useIngestStore.getState().error).toBeInstanceOf(ApiError)
    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].kind).toBe('ingest-failure')
  })

  it('aborts the previous poll loop when a new upload starts', async () => {
    const responses = [
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j1', filename: 'a.md', status: 'running', error: null }),
      jsonRes({ job_id: 'j2', filename: 'b.md', status: 'pending', error: null }),
      jsonRes({ job_id: 'j2', filename: 'b.md', status: 'done', error: null }),
    ]
    let i = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(responses[i++] ?? responses[responses.length - 1])))

    await useIngestStore.getState().upload(new File(['x'], 'a.md'))
    await vi.advanceTimersByTimeAsync(1500) // j1 → running
    await useIngestStore.getState().upload(new File(['y'], 'b.md'))
    await vi.advanceTimersByTimeAsync(1500) // j2 → done

    const notifs = useNotificationsStore.getState().items
    expect(notifs).toHaveLength(1)
    expect(notifs[0].filename).toBe('b.md')
  })

  it('exposes ApiError on the store when the initial upload POST fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonRes({ code: 'VALIDATION_ERROR', message: 'bad file', request_id: null }, false, 422),
    ))
    await useIngestStore.getState().upload(new File(['x'], 'x.md'))
    expect(useIngestStore.getState().error).toBeInstanceOf(ApiError)
    expect(useIngestStore.getState().error?.code).toBe('VALIDATION_ERROR')
    expect(useIngestStore.getState().job).toBeNull()
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/stores/__tests__/ingestStore.test.ts`
Expected: FAIL with "Cannot find module '../ingestStore'".

- [ ] **Step 3.3: Implement the store**

Create `frontend/src/stores/ingestStore.ts`:

```ts
import { create } from 'zustand'
import { ApiError, coerceApiError, getIngestJob, ingestFile } from '../lib/api'
import type { IngestJob } from '../lib/types'
import { useNotificationsStore } from './notificationsStore'

interface IngestState {
  job: IngestJob | null
  uploading: boolean
  error: ApiError | null
  upload: (file: File) => Promise<void>
}

// Module-local poll handle — not part of store state.
const pollRef: { current: ReturnType<typeof setInterval> | null } = { current: null }

function stopPolling(): void {
  if (pollRef.current) {
    clearInterval(pollRef.current)
    pollRef.current = null
  }
}

function notifyDone(job: IngestJob): void {
  useNotificationsStore.getState().push({
    kind: 'ingest-success',
    title: `Compiled ${job.filename}`,
    filename: job.filename,
    jobId: job.job_id,
  })
}

function notifyFailed(job: IngestJob, message: string | null): void {
  useNotificationsStore.getState().push({
    kind: 'ingest-failure',
    title: `Failed to compile ${job.filename}`,
    detail: message ?? undefined,
    filename: job.filename,
    jobId: job.job_id,
  })
}

export const useIngestStore = create<IngestState>((set, get) => ({
  job: null,
  uploading: false,
  error: null,
  upload: async (file: File) => {
    stopPolling()
    set({ uploading: true, error: null, job: null })
    try {
      const newJob = await ingestFile(file)
      set({ job: newJob })

      pollRef.current = setInterval(async () => {
        try {
          const updated = await getIngestJob(newJob.job_id)
          const prev = get().job
          if (prev?.job_id !== newJob.job_id) {
            // A newer upload has replaced us; ignore stale response.
            return
          }
          if (prev.status !== updated.status) set({ job: updated })
          if (updated.status === 'done') {
            stopPolling()
            notifyDone(updated)
          } else if (updated.status === 'failed') {
            stopPolling()
            notifyFailed(updated, updated.error)
          }
        } catch (e: unknown) {
          const apiErr = coerceApiError(e, 'Upload failed.')
          const prev = get().job
          if (prev?.job_id !== newJob.job_id) return
          const failed: IngestJob = { ...prev, status: 'failed', error: apiErr.message }
          set({ job: failed, error: apiErr })
          stopPolling()
          notifyFailed(failed, apiErr.message)
        }
      }, 1500)
    } catch (e: unknown) {
      set({ error: coerceApiError(e, 'Upload failed.') })
    } finally {
      set({ uploading: false })
    }
  },
}))
```

- [ ] **Step 3.4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/stores/__tests__/ingestStore.test.ts`
Expected: PASS — all 7 tests green.

- [ ] **Step 3.5: Commit**

```bash
git add frontend/src/stores/ingestStore.ts frontend/src/stores/__tests__/ingestStore.test.ts
git commit -m "feat(stores): add ingestStore with polling and completion notifications"
```

---

## Task 4: refactor `useIngest` to delegate to `ingestStore`

**Files:**
- Modify: `frontend/src/hooks/useIngest.ts`

- [ ] **Step 4.1: Replace the hook body**

Overwrite `frontend/src/hooks/useIngest.ts` with:

```ts
import { useIngestStore } from '../stores/ingestStore'

export function useIngest() {
  const job = useIngestStore(s => s.job)
  const uploading = useIngestStore(s => s.uploading)
  const error = useIngestStore(s => s.error)
  const upload = useIngestStore(s => s.upload)
  return { job, uploading, error, upload }
}
```

Why single-field selectors: Zustand re-renders subscribers only when the selected slice changes. Selecting primitives one-by-one gives `IngestPage` the same render cadence it has today.

- [ ] **Step 4.2: Run all frontend tests**

Run: `cd frontend && pnpm test`
Expected: PASS — every suite green, including `src/hooks/__tests__/useIngest.test.ts` unchanged.

If `useIngest.test.ts` fails because it relies on hook-local state isolation that the store no longer provides, reset the store in a `beforeEach` hook at the top of that file:

```ts
import { useIngestStore } from '../../stores/ingestStore'
// ...
beforeEach(() => {
  vi.restoreAllMocks()
  useIngestStore.setState({ job: null, uploading: false, error: null })
})
```

Only add this if the run fails — do not pre-emptively modify the file.

- [ ] **Step 4.3: Commit**

```bash
git add frontend/src/hooks/useIngest.ts
# if you also had to reset state in the test:
# git add frontend/src/hooks/__tests__/useIngest.test.ts
git commit -m "refactor(hooks): delegate useIngest to ingestStore"
```

---

## Task 5: shimmer animation on the active Compile stage bar

**Files:**
- Modify: `frontend/src/components/IngestDropzone.tsx`
- Test: `frontend/src/components/__tests__/IngestDropzone.test.tsx` (new)

- [ ] **Step 5.1: Write the failing test**

Create `frontend/src/components/__tests__/IngestDropzone.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IngestDropzone } from '../IngestDropzone'
import type { IngestJob } from '../../lib/types'

function job(status: IngestJob['status'], error: string | null = null): IngestJob {
  return { job_id: 'j1', filename: 'a.md', status, error }
}

describe('IngestDropzone shimmer', () => {
  it('renders the shimmer element on the active Compile stage while running', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('running')} uploading={false} />
    )
    const shimmers = container.querySelectorAll('[data-shimmer="true"]')
    expect(shimmers).toHaveLength(1)
  })

  it('does not render a shimmer element when the job has failed', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('failed', 'boom')} uploading={false} />
    )
    expect(container.querySelectorAll('[data-shimmer="true"]')).toHaveLength(0)
  })

  it('does not render a shimmer element when the job is done', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('done')} uploading={false} />
    )
    expect(container.querySelectorAll('[data-shimmer="true"]')).toHaveLength(0)
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/IngestDropzone.test.tsx`
Expected: FAIL — no elements with `data-shimmer="true"`.

- [ ] **Step 5.3: Add the shimmer keyframes to global styles**

Open `frontend/src/styles/globals.css` and append to the end of the file:

```css
@keyframes ingest-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

- [ ] **Step 5.4: Update `IngestDropzone.tsx` bar rendering**

Open `frontend/src/components/IngestDropzone.tsx`. Locate the `<li>` block inside the `STAGES.map` around lines 189–208 and replace the bar `<span>` with:

```tsx
<span
  className="relative h-[3px] rounded-full overflow-hidden transition-[background,opacity] duration-500"
  style={{ background: color, opacity: reached ? 1 : 0.5 }}
>
  {active && !failed && (
    <span
      data-shimmer="true"
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
        animation: 'ingest-shimmer 2.8s ease-in-out infinite',
      }}
    />
  )}
</span>
```

Leave the surrounding markup — title, description, grid layout — unchanged.

- [ ] **Step 5.5: Run the component test**

Run: `cd frontend && npx vitest run src/components/__tests__/IngestDropzone.test.tsx`
Expected: PASS — all 3 tests green.

- [ ] **Step 5.6: Run lint and the full frontend suite**

Run: `cd frontend && pnpm lint && pnpm test`
Expected: both green.

- [ ] **Step 5.7: Commit**

```bash
git add frontend/src/components/IngestDropzone.tsx frontend/src/components/__tests__/IngestDropzone.test.tsx frontend/src/styles/globals.css
git commit -m "feat(ingest): shimmer animation on active Compile stage"
```

---

## Task 6: `NotificationItem`

**Files:**
- Create: `frontend/src/components/Notifications/NotificationItem.tsx`

This task does not add its own tests — `NotificationItem` is covered by the component-level test in Task 8.

- [ ] **Step 6.1: Implement the item**

Create `frontend/src/components/Notifications/NotificationItem.tsx`:

```tsx
import { useNotificationsStore, type Notification } from '../../stores/notificationsStore'
import { formatRelativeTime } from '../../utils/relativeTime'

interface Props {
  item: Notification
  onActivate: (item: Notification) => void
}

export function NotificationItem({ item, onActivate }: Props) {
  const markRead = useNotificationsStore(s => s.markRead)
  const remove = useNotificationsStore(s => s.remove)

  const dotColor = item.read
    ? 'var(--color-line-strong)'
    : item.kind === 'ingest-failure'
      ? 'var(--color-error-crimson)'
      : 'var(--color-accent)'

  return (
    <li
      role="menuitem"
      tabIndex={0}
      onClick={() => onActivate(item)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onActivate(item)
        }
      }}
      className={[
        'group flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer border-b border-line-strong/40 last:border-b-0',
        item.read ? '' : 'bg-accent/5',
        'hover:bg-sand',
      ].join(' ')}
    >
      <span
        aria-hidden
        className="mt-[7px] w-[7px] h-[7px] rounded-full flex-shrink-0"
        style={{ background: dotColor }}
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-[1.35] text-fg font-medium truncate">{item.title}</p>
        {item.detail && (
          <p className="text-[11.5px] text-fg-muted truncate mt-0.5">{item.detail}</p>
        )}
        <p className="text-[11px] text-fg-dim mt-0.5 font-mono">
          {formatRelativeTime(item.createdAt)}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <button
          type="button"
          aria-label={item.read ? 'Mark as unread' : 'Mark as read'}
          title={item.read ? 'Mark as unread' : 'Mark as read'}
          onClick={e => {
            e.stopPropagation()
            markRead(item.id)
          }}
          className="w-[22px] h-[22px] grid place-items-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 6 9 17l-5-5" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="Delete notification"
          title="Delete"
          onClick={e => {
            e.stopPropagation()
            remove(item.id)
          }}
          className="w-[22px] h-[22px] grid place-items-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg"
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </li>
  )
}
```

- [ ] **Step 6.2: Lint**

Run: `cd frontend && pnpm lint`
Expected: PASS.

- [ ] **Step 6.3: Commit**

```bash
git add frontend/src/components/Notifications/NotificationItem.tsx
git commit -m "feat(notifications): add NotificationItem row component"
```

---

## Task 7: `NotificationsDropdown`

**Files:**
- Create: `frontend/src/components/Notifications/NotificationsDropdown.tsx`

- [ ] **Step 7.1: Implement the dropdown panel**

Create `frontend/src/components/Notifications/NotificationsDropdown.tsx`:

```tsx
import { useNotificationsStore, selectUnreadCount, type Notification } from '../../stores/notificationsStore'
import { NotificationItem } from './NotificationItem'

interface Props {
  onActivate: (item: Notification) => void
}

export function NotificationsDropdown({ onActivate }: Props) {
  const items = useNotificationsStore(s => s.items)
  const markAllRead = useNotificationsStore(s => s.markAllRead)
  const unread = useNotificationsStore(selectUnreadCount)

  return (
    <div
      role="menu"
      aria-label="Notifications"
      className="w-[360px] bg-surface rounded-xl overflow-hidden"
      style={{ boxShadow: 'var(--shadow-ring), 0 10px 32px rgba(0,0,0,0.08)' }}
    >
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-line-strong/40">
        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-muted">
          Notifications
        </span>
        <button
          type="button"
          onClick={markAllRead}
          disabled={unread === 0}
          className="text-[11.5px] text-accent disabled:text-fg-dim disabled:cursor-default hover:underline underline-offset-[3px]"
        >
          Mark all read
        </button>
      </div>
      {items.length === 0 ? (
        <div className="py-8 px-4 text-center text-[13px] text-fg-muted">
          No notifications yet.
        </div>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {items.map(item => (
            <NotificationItem key={item.id} item={item} onActivate={onActivate} />
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 7.2: Lint**

Run: `cd frontend && pnpm lint`
Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add frontend/src/components/Notifications/NotificationsDropdown.tsx
git commit -m "feat(notifications): add NotificationsDropdown panel"
```

---

## Task 8: `<Notifications />` bell trigger + integration tests

**Files:**
- Create: `frontend/src/components/Notifications/index.tsx`
- Test: `frontend/src/components/Notifications/__tests__/Notifications.test.tsx`

- [ ] **Step 8.1: Write the failing test**

Create `frontend/src/components/Notifications/__tests__/Notifications.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Notifications } from '../index'
import { useNotificationsStore } from '../../../stores/notificationsStore'

const navigate = vi.fn()
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigate }
})

function renderUnderRouter() {
  return render(
    <MemoryRouter>
      <Notifications />
    </MemoryRouter>
  )
}

beforeEach(() => {
  navigate.mockReset()
  useNotificationsStore.setState({ items: [] })
})

describe('<Notifications />', () => {
  it('does not show a badge when there are no unread items', () => {
    renderUnderRouter()
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
  })

  it('shows a count badge when unread > 0, and "9+" beyond 9', () => {
    const { push } = useNotificationsStore.getState()
    for (let i = 0; i < 3; i++) push({ kind: 'ingest-success', title: `n${i}`, filename: 'a.md', jobId: String(i) })
    renderUnderRouter()
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('3')

    useNotificationsStore.setState({ items: [] })
    for (let i = 0; i < 15; i++) useNotificationsStore.getState().push({
      kind: 'ingest-success', title: `n${i}`, filename: 'a.md', jobId: String(i),
    })
    expect(screen.getByTestId('notifications-badge')).toHaveTextContent('9+')
  })

  it('opens the dropdown when the bell is clicked and closes on Escape', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByRole('menu', { name: /notifications/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: /notifications/i })).toBeNull()
  })

  it('closes the dropdown on outside pointerdown', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByRole('menu', { name: /notifications/i })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu', { name: /notifications/i })).toBeNull()
  })

  it('shows the empty state when there are no items', () => {
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument()
  })

  it('navigates to /wiki on success row click and marks read', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByText('Compiled a.md'))
    expect(navigate).toHaveBeenCalledWith('/wiki')
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('navigates to /ingest on failure row click and marks read', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-failure', title: 'Failed to compile b.md', filename: 'b.md', jobId: 'j2', detail: 'boom',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByText('Failed to compile b.md'))
    expect(navigate).toHaveBeenCalledWith('/ingest')
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('hover delete button removes without triggering navigation', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete notification/i }))
    expect(navigate).not.toHaveBeenCalled()
    expect(useNotificationsStore.getState().items).toHaveLength(0)
  })

  it('hover mark-read button toggles read state without triggering navigation', () => {
    useNotificationsStore.getState().push({
      kind: 'ingest-success', title: 'Compiled a.md', filename: 'a.md', jobId: 'j1',
    })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    fireEvent.click(screen.getByRole('button', { name: /mark as read/i }))
    expect(navigate).not.toHaveBeenCalled()
    expect(useNotificationsStore.getState().items[0].read).toBe(true)
  })

  it('"Mark all read" clears the unread count and is disabled at zero', () => {
    const { push } = useNotificationsStore.getState()
    push({ kind: 'ingest-success', title: 'a', filename: 'a.md', jobId: '1' })
    push({ kind: 'ingest-success', title: 'b', filename: 'b.md', jobId: '2' })
    renderUnderRouter()
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }))
    const markAll = screen.getByRole('button', { name: /mark all read/i })
    expect(markAll).not.toBeDisabled()
    fireEvent.click(markAll)
    expect(useNotificationsStore.getState().items.every(i => i.read)).toBe(true)
    expect(screen.queryByTestId('notifications-badge')).toBeNull()
    expect(markAll).toBeDisabled()
  })
})
```

- [ ] **Step 8.2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/Notifications/__tests__/Notifications.test.tsx`
Expected: FAIL with "Cannot find module '../index'".

- [ ] **Step 8.3: Implement the bell + popover**

Create `frontend/src/components/Notifications/index.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { selectUnreadCount, useNotificationsStore, type Notification } from '../../stores/notificationsStore'
import { NotificationsDropdown } from './NotificationsDropdown'

function badgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count)
}

export function Notifications() {
  const [isOpen, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const unread = useNotificationsStore(selectUnreadCount)
  const markRead = useNotificationsStore(s => s.markRead)

  useEffect(() => {
    if (!isOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function onPointer(e: PointerEvent) {
      if (!wrapperRef.current) return
      if (e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [isOpen])

  function handleActivate(item: Notification) {
    markRead(item.id)
    setOpen(false)
    navigate(item.kind === 'ingest-success' ? '/wiki' : '/ingest')
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Notifications"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setOpen(v => !v)}
        className="relative w-9 h-9 grid place-items-center rounded-lg text-fg-muted hover:bg-sand hover:text-fg transition-colors duration-200"
      >
        <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            data-testid="notifications-badge"
            aria-label={`${unread} unread`}
            className="absolute top-1 right-1 min-w-[14px] h-[14px] px-[3px] text-[9.5px] font-bold bg-accent text-fg-onaccent rounded-full grid place-items-center"
            style={{ boxShadow: '0 0 0 2px var(--color-canvas)' }}
          >
            {badgeLabel(unread)}
          </span>
        )}
      </button>
      {isOpen && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-40">
          <NotificationsDropdown onActivate={handleActivate} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 8.4: Run the test**

Run: `cd frontend && npx vitest run src/components/Notifications/__tests__/Notifications.test.tsx`
Expected: PASS — all 10 tests green.

- [ ] **Step 8.5: Run the full suite**

Run: `cd frontend && pnpm lint && pnpm test`
Expected: both green.

- [ ] **Step 8.6: Commit**

```bash
git add frontend/src/components/Notifications/index.tsx frontend/src/components/Notifications/__tests__/Notifications.test.tsx
git commit -m "feat(notifications): add bell trigger with dropdown popover"
```

---

## Task 9: wire `<Notifications />` into `AppHeader`

**Files:**
- Modify: `frontend/src/components/AppHeader.tsx`

- [ ] **Step 9.1: Replace the static bell button**

Open `frontend/src/components/AppHeader.tsx`. At the top, add:

```tsx
import { Notifications } from './Notifications'
```

Then, inside the right-cluster `<div className="flex items-center gap-1">` block, delete the existing static bell `<button>` (lines 69–79 in the current file) and replace it with a single line:

```tsx
<Notifications />
```

Leave the sidebar-toggle button, theme button, and avatar span untouched.

- [ ] **Step 9.2: Run lint and the full suite**

Run: `cd frontend && pnpm lint && pnpm test`
Expected: both green. No existing test is expected to break — `AppHeader` has no direct tests and the indirect tests do not assert on the bell markup.

- [ ] **Step 9.3: Manual smoke test in the browser**

Steps:

1. From repo root: `pnpm dev`
2. Open `http://localhost:5173/ingest`, drop a `.md` file.
3. Confirm the Compile stage bar shimmers slowly while status is `running`.
4. While the job is running, navigate to `/wiki`. Navigate back to `/ingest`. Confirm the pipeline view still shows the same job in-progress.
5. When the job reaches `done`, confirm the bell icon in the header shows a "1" badge.
6. Click the bell. Confirm a dropdown opens with one row "Compiled <filename>".
7. Hover the row. Confirm two icon buttons appear.
8. Click the row. Confirm navigation to `/wiki` and that the badge disappears.
9. Re-open the dropdown. Click the delete icon on the existing item. Confirm it is removed.

Briefly cover the failure path: run `pnpm dev` against a backend misconfigured so ingest fails (e.g., unset `LLM_MODEL` and restart backend). Repeat from step 2. Confirm the Compile bar does not shimmer on failure and that a failure notification appears. Clicking the failure row should navigate to `/ingest`.

If the manual smoke test reveals anything off, fix inline and extend Task 8's tests to cover the gap.

- [ ] **Step 9.4: Commit**

```bash
git add frontend/src/components/AppHeader.tsx
git commit -m "feat(header): wire Notifications component into AppHeader"
```

---

## Final verification

- [ ] **Step 10.1: Full frontend checks**

Run: `cd frontend && pnpm lint && pnpm test`
Expected: both green.

- [ ] **Step 10.2: Confirm scope**

Use `git log --oneline` to confirm the branch contains only the nine feature commits above, in order. No stray changes to `backend/`, `docs/superpowers/specs/`, or unrelated frontend files.

- [ ] **Step 10.3: Suggest next steps to the user**

Do not push, merge, or open a PR. Surface that the work is ready for review and wait for the user to request the next action explicitly (per the project rule: commits are shared state).
