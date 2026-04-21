# Ingest UI improvements — design

**Status:** Draft
**Date:** 2026-04-21
**Scope:** Three UI improvements on the Ingest flow — a compile-stage loading
animation, cross-route state persistence for in-flight ingests, and a
notification system seeded by ingest events.

(The `ErrorBanner` removal from `IngestPage` was done manually by the user
before this design; it is out of scope here. `useIngest`'s current public
surface — including its `error` field — is preserved.)

## Goals

1. Give the long-running **Compile** stage a loading animation so the user
   does not mistake it for a stall.
2. Let an ingest in flight **survive client-side navigation** (leave
   `/ingest`, come back, state is intact). Browser refresh is out of scope
   — refresh drops the state.
3. Start a **notification system** keyed off the bell icon in `AppHeader`.
   Ingest completion (success or failure) pushes a notification; the
   dropdown shows a scrollable list with per-item read/delete actions.

## Non-goals

- No persistence to `localStorage` or backend.
- No notifications from other subsystems (chat, wiki, lint) — ingest only
  for v1. The store is designed so other sources can be added later
  without schema churn, but we do not wire them now.
- No backend changes. The `IngestJob` response keeps its current shape.
- No cleanup of `useIngest`'s `error` field. Its current surface
  (`{ job, uploading, upload, error }`) is preserved so no caller-site
  change is required.

## Architecture

```
┌──────────────────────┐      ┌──────────────────────────┐
│   ingestStore (new)  │─────▶│ notificationsStore (new) │
│   • job, uploading   │ push │  • items[] (capped 50)   │
│   • error            │      │  • unreadCount (selector)│
│   • upload()         │      │  • push/markRead/        │
│   • polling interval │      │    markAllRead/remove    │
│     (module-local)   │      │                          │
└──────────┬───────────┘      └───────────┬──────────────┘
           │                              │
           ▼                              ▼
   useIngest() hook              <Notifications />
   (thin selector)               (bell trigger + dropdown;
           │                      owns isOpen locally)
           ▼
     IngestPage
     IngestDropzone
```

Polling and completion detection live **inside** `ingestStore`, not in a
component effect. This is what lets an in-flight ingest survive
navigation: unmounting `IngestPage` no longer cancels polling. It also
guarantees the completion notification fires exactly once per job, because
the store is the only subscriber to the poll loop.

Existing patterns followed:

- `chatStore` already uses Zustand + a module-local `abortRef` handle for
  non-state async resources. `ingestStore` mirrors this with a
  module-local interval handle.
- `previewStore` already uses Zustand for cross-component UI state.
- `coerceApiError` / `ApiError` are the existing error primitives and are
  reused for failure-path messages.

## Data model

```ts
// stores/ingestStore.ts
interface IngestState {
  job: IngestJob | null
  uploading: boolean
  error: ApiError | null
  upload: (file: File) => Promise<void>
}

// stores/notificationsStore.ts
type Notification = {
  id: string               // crypto.randomUUID()
  kind: 'ingest-success' | 'ingest-failure'
  title: string            // e.g. "Compiled auth-overview.md"
  detail?: string          // failure message, or a short success note
  filename: string
  jobId: string
  createdAt: number        // Date.now()
  read: boolean
}

interface NotificationsState {
  items: Notification[]    // newest first
  push: (n: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void
  markRead: (id: string) => void
  markAllRead: () => void
  remove: (id: string) => void
}
```

`unreadCount` is **not stored** — it is derived via a selector
(`useNotificationsStore(s => s.items.filter(i => !i.read).length)`) to
avoid drift.

The `items` array is capped at **50**; pushing a 51st drops the oldest.

## Components

### `stores/ingestStore.ts` (new)

Hoists the logic currently in `hooks/useIngest.ts` into a store:

- `upload(file)` aborts any previous polling interval, POSTs to
  `/api/ingest`, stores the returned `job`, and starts polling
  `/api/ingest/{job_id}` every 1500 ms (matching current behavior).
- Inside the poll callback, on `updated.status === 'done'`: push an
  `ingest-success` notification (title `Compiled {filename}`), stop
  polling.
- On `updated.status === 'failed'` (server-reported **or** poll request
  failure that coerces to an `ApiError`): set `job.status = 'failed'`
  with `job.error = <message>`, push an `ingest-failure` notification
  (title `Failed to compile {filename}`, `detail` = error message), stop
  polling.
- Preserves the `error: ApiError | null` field on the current hook
  surface. No caller reads it today; the migration is intentionally
  surgical and leaves it in place.

### `hooks/useIngest.ts`

Becomes a thin selector wrapper:

```ts
export function useIngest() {
  return useIngestStore(s => ({
    job: s.job, uploading: s.uploading, error: s.error, upload: s.upload,
  }))
}
```

Public surface (`{ job, uploading, upload, error }`) is unchanged, so
neither `IngestPage` nor the existing `useIngest.test.ts` needs to
change.

### `stores/notificationsStore.ts` (new)

Straightforward Zustand store matching the shape above. `push` sets
`id`/`createdAt`/`read: false`, prepends to `items`, then truncates to
50.

### `components/IngestDropzone.tsx`

One visual change: the **active, non-failed** Compile stage bar renders a
shimmer animation.

- Implementation: add a `::after` pseudo-element on the active bar
  carrying a translucent-white linear gradient that translates across.
- Animation: `shimmer 2.8s ease-in-out infinite` (slower than a typical
  progress shimmer — user requested a slower cycle so it reads as
  "working" rather than "urgent").
- Applied only when `active === true && !failed`. Other bars keep their
  existing static color.

No other structural changes. The `failed && job.error` block stays.

### `components/Notifications/` (new)

```
components/Notifications/
  index.tsx                 // bell trigger; owns isOpen, anchor ref
  NotificationsDropdown.tsx // the panel (rendered when isOpen)
  NotificationItem.tsx      // single row
```

- **`index.tsx`** — renders the bell button with badge. Reads
  `unreadCount` from the store. Owns local UI state (`isOpen`) so
  `AppHeader` does not re-render when the dropdown toggles. Handles
  click-outside (`pointerdown` listener while open), Escape to close,
  focus restoration to the bell.
- Badge: small accent dot with count (shown when `unreadCount > 0`; hide
  count when `unreadCount > 9` and show `9+`).
- **`NotificationsDropdown.tsx`** — header row ("Notifications" +
  "Mark all read" button, disabled when `unreadCount === 0`); scrollable
  list of `NotificationItem`s (max height ~420px); empty-state "No
  notifications yet."
- **`NotificationItem.tsx`** — colored dot (accent = unread success,
  crimson = unread failure, `--color-line-strong` = read), title,
  relative timestamp. On hover, two icon buttons appear: mark-read
  toggle + delete. `onClick` on those buttons calls
  `stopPropagation()` so they don't trigger row navigation.
- Row click:
  - `ingest-success` → navigate to `/wiki` (wiki list — we do not have
    per-slug info in the `IngestJob` response), mark read, close
    dropdown.
  - `ingest-failure` → navigate to `/ingest` so the user can see the
    full error, mark read, close dropdown.

### `components/AppHeader.tsx`

Replace the inline static bell `<button>` with `<Notifications />`. No
other change. No new props threaded through — `AppHeader`'s existing
props (`onMobileMenuOpen`, `sidebarCollapsed`, `onSidebarToggle`) are
untouched.

### `utils/relativeTime.ts` (new directory, first resident)

```ts
export function formatRelativeTime(ts: number, now = Date.now()): string
```

Buckets: `"just now"` (<60s), `"Nm ago"` (<60m), `"Nh ago"` (<24h),
`"yesterday"` (<48h), localized date (`toLocaleDateString`) beyond that.
No new dependency.

## Data flow — a complete ingest

1. User drops a file on `IngestPage`. `upload()` runs on `ingestStore`.
2. `ingestStore` POSTs, stores `job`, starts the poll interval.
3. User navigates to `/wiki`. `IngestPage` unmounts. `ingestStore`'s
   interval keeps running.
4. Poll sees `status: 'done'`. Store pushes an `ingest-success`
   notification into `notificationsStore` and stops polling.
5. Bell badge updates (it reads `unreadCount` from the store). User sees
   "1" on the bell.
6. User clicks the bell. Dropdown opens (owned by `<Notifications />`).
7. User clicks the notification. App routes to `/wiki`, notification is
   marked read, dropdown closes.
8. `ingestStore.job` still holds the terminal job state. If the user
   later navigates back to `/ingest`, they see the final pipeline
   view. Uploading a new file replaces the job (and aborts any stale
   interval — no-op here since the interval already stopped).

## Edge cases

- **Second upload while one is in flight** — `upload()` aborts the
  existing interval before starting the new one. The previous job will
  never fire a notification, which is correct because the user replaced
  it explicitly.
- **Network failure on a poll tick** — handled the same as
  server-reported failure: coerce to `ApiError`, set `job.status =
  'failed'`, push failure notification, stop polling.
- **Full page refresh mid-ingest** — in-memory state is lost (per user
  choice). The backend job may still be running; the user cannot observe
  it. Acceptable tradeoff.
- **50-item cap hit** — oldest notification is dropped silently. No UI
  affordance for this in v1.
- **Dropdown open while a new notification arrives** — the list
  re-renders with the new item at the top (store subscription handles
  this automatically).
- **Clicking an old failure notification after starting a new upload**
  — navigation still goes to `/ingest`, but the page shows the current
  `ingestStore.job`, not the older failed one the notification refers
  to. Acceptable: the page is always a view of the latest job, and the
  notification's purpose is "something failed; go look at the ingest
  page". The notification is still marked read.
- **Mark-read button semantics** — the hover icon is a **toggle**:
  clicking on an unread row marks it read, clicking on a read row marks
  it unread. Matches the test "flips read state".

## Testing (TDD)

Tests are written **before** implementation per the project's mandatory
TDD rule. One failing test per behavior, then the minimum code to pass.

### `stores/__tests__/ingestStore.test.ts` (new)

- `upload()` sets `uploading: true`, then populates `job` from the API.
- Polling updates `job.status` as responses change.
- On `status === 'done'`, polling stops and exactly one success
  notification lands in `notificationsStore`.
- On `status === 'failed'`, polling stops and exactly one failure
  notification lands with `job.error` as `detail`.
- A second `upload()` while one is in flight aborts the first's polling
  (the old job never produces a notification after the swap).
- Poll-time network error coerces to `ApiError`, sets `job.status =
  'failed'`, pushes failure notification.

### `stores/__tests__/notificationsStore.test.ts` (new)

- `push` prepends, sets `read: false`, generates `id` and `createdAt`.
- `markRead` flips one item; `markAllRead` flips all.
- `remove` deletes by id.
- 50-item cap: 51st push drops the oldest.
- `unreadCount` selector returns the right count as items change.

### `components/Notifications/__tests__/Notifications.test.tsx` (new)

- Bell badge hidden when no unread; shown with correct count when
  unread > 0; shows `9+` when > 9.
- Click bell opens dropdown; Escape closes; click-outside closes.
- Empty-state text renders when no items.
- Row click on success routes to `/wiki` and marks read.
- Row click on failure routes to `/ingest` and marks read.
- Hover mark-read button flips read state without triggering row
  navigation.
- Hover delete button removes the item without triggering row
  navigation.
- "Mark all read" button clears the unread count and is disabled when
  already zero.

### `utils/__tests__/relativeTime.test.ts` (new)

- Each bucket returns the expected string for a representative
  timestamp.

### `hooks/__tests__/useIngest.test.ts`

Not modified. The hook's public surface is preserved by design, and the
existing failure-path assertion on `result.current.error` continues to
hold because `ingestStore` exposes the same field.

### `components/__tests__/IngestDropzone.test.tsx` (update / add if missing)

- Active Compile stage renders the shimmer element (assert a class /
  `data-*` attribute is present); non-active stages do not.

## Verification

Per the project rule "Verification before done":

- `cd frontend && pnpm lint` — green.
- `cd frontend && pnpm test` — green.

No backend changes, so no pytest run required for this work.

## Follow-ups (out of scope)

- Backend could return the list of slugs the ingest produced/updated so
  success notifications can deep-link to a specific page instead of the
  wiki list. Requires an `IngestJob` schema change; deferred.
- `localStorage` persistence for notifications and in-flight ingest
  state (the B option from brainstorming). Deferred pending a real need.
- Notification sources beyond ingest (lint warnings, chat errors).
  Store schema already supports more `kind` values via discriminated
  union; deferred until a second producer is actually needed.
