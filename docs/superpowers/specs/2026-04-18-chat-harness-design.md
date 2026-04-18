# Chat Harness — Design Spec

**Date:** 2026-04-18
**Status:** Draft

## Context

The current chat flow is stateless and single-turn: one `POST /api/chat` with a single `question`, no memory of prior turns. The UI has no Stop button, no way to edit the last message, and citations render as bare slug chips — users can't preview the source or jump to the cited passage.

This spec designs three tightly related chat-page features that ship together:

1. **F1 — Session memory.** The chat becomes stateful within a session (A from the "memory scope" question), preserved across route navigation via a Zustand store. Cleared on reload.
2. **F2 — Stop + edit-last.** An `AbortController` cancels the in-flight stream; partial assistant text is kept. Clicking the last user bubble enters edit mode; submitting truncates the thread to that point and re-sends.
3. **F3 — Citations with preview + navigation.** LLM emits line-ranged citations (`{{slug:start-end}}`) in a trailing `__CITATIONS__:` block. Each citation renders as a clickable chip labeled "References". Hover >2s → slide-in side panel shows line-numbered source with the range highlighted. Double-click → navigates to the wiki page, scrolls to the range, highlights it with a 5s fade.

## Acceptance criteria

- Chat preserves conversation history across route navigation (e.g., `/` → `/wiki` → `/`) within a session.
- Page reload resets the chat (no persistence for MVP).
- Prior turns are sent to the backend and inform follow-up answers (e.g., "tell me more about that" works).
- While streaming, the Send button morphs into Stop; clicking Stop aborts the stream and preserves any partial assistant text.
- Clicking the most recent user bubble enters edit mode with an inline textarea; saving truncates the thread to before that message and re-sends. Only the last user message is editable.
- A "New chat" button in the chat-panel header clears the thread (stops any in-flight stream first).
- Assistant replies render a "References" footer of chips, each labeled `{slug}:{start}-{end}` (or `{slug}:{n}` for a single line).
- Hovering a chip for ~2s opens a slide-in side panel on the right of the chat column showing the cited lines (±3 lines of context) with the range highlighted.
- Preview panel dismisses on mouse-leave-region (with 200ms grace), outside click, or Esc.
- Double-clicking a chip navigates to `/wiki/<slug>?lines=<start>-<end>`; the page auto-scrolls to the block(s) covering that range and highlights them with a warm-yellow background that fades out after 5s.
- Malformed citations, out-of-bounds ranges, and missing matches fail gracefully without toasts, banners, or crashes.

## Non-goals

- Persistence across page reloads (Option B) or multiple conversation threads (Option C) — explicitly deferred; Zustand store shape is designed to allow drop-in migration later.
- Branching edits (III from edit question) — deferred; edit replaces the tail of the thread.
- Editing arbitrary prior user messages — only the last user message is editable.
- Inline `{{slug:...}}` citation markers within the answer body — citations are trailing-only.
- Character-precise highlight within a block — highlight is block-granular.
- Server-side validation of citation ranges — frontend handles graceful fallbacks.
- Caching invalidation beyond the page session — manual page refresh is the refresh path, same as today's wiki viewer.

## Architecture overview

```
ChatInput → useChatStore.send(text)
  → fetch('/api/chat', {signal}, body: {messages})
  → SSE stream: data events (tokens) / event: error
  → store appends tokens to assistant msg; on __CITATIONS__: split → citations[]
  → ChatMessage renders body + <ReferenceChip/>s
  → ReferenceChip: hover(2s) → usePreviewStore.openPreview(citation)
                   dblclick → navigate(`/wiki/${slug}?lines=${range}`)
  → <PreviewPanel/> at ChatPage root fetches content (cached) + renders slice
  → WikiPage: useWikiHighlight(contentRef, linesParam) scrolls + highlights via data-source-line-* attrs
```

Single source of truth for wiki content stays `GET /api/wiki/:slug`. No new endpoints.

## Backend changes (`backend/kb/`)

### `ChatRequest` model (`kb/wiki/models.py`)

Replace `{ question: str }` with:

```python
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatTurn]
```

Validator in `api/chat.py`: `messages` non-empty, last turn has `role == "user"`, all `content.strip()` non-empty.

### `QueryAgent.query` signature

```python
async def query(self, messages: list[dict]) -> AsyncIterator[str]
```

### Phase 1 — page selection (non-streaming)

Pass the **last 2–3 turns** (constant `SELECT_HISTORY_TURNS = 3`) plus the index to the selection prompt. Enough context for anaphora resolution ("tell me more about that") without burning prompt tokens on long histories. Still returns a comma-separated slug list.

### Phase 2 — answer generation (streaming)

Build the OpenAI-style request as:

- **System message:** line-numbered page contents + citation instructions.
- **Chat turns:** the full `messages[]` from the request.

Line numbering: each page rendered as
```
--- {slug} ---
1: line one
2: line two
3: line three
...
```
1-indexed, plain-text prefix.

Citation instructions appended to the system message:

> When you finish, on its own final line, append:
> `__CITATIONS__:slug-one:15-22,slug-two:30-45`
>
> Each entry is `slug:line_start-line_end` (inclusive, 1-indexed). Use a single line number like `:30` for one line. Cite ranges that directly back a claim. Prefer tight ranges (3–15 lines). Never invent line numbers — if you can't locate a supporting passage, omit that source.
>
> Example:
> `__CITATIONS__:deploy-process:15-22,ci-cd:30`

### Marker name preserved

The SSE marker name stays `__CITATIONS__` (no rename to `__REFERENCES__`). The visible UI label renders as "References".

### Stop / abort behavior

`sse_starlette` cancels the generator on client disconnect. Add an explicit `except asyncio.CancelledError: raise` in `event_generator` so client-cancellation is not logged as a server-side error.

### Backend tests (`backend/tests/`)

- `test_chat_api.py`: validate the `{messages}` contract, reject empty / non-user-last / blank-content payloads, client disconnect does not produce an error log.
- `test_query_agent.py`: Phase 1 receives last N turns; Phase 2 receives line-numbered pages + full history; `__CITATIONS__` instructions present in the system prompt.

## Frontend changes (`frontend/src/`)

### State: `useChatStore` (Zustand)

New file: `stores/chatStore.ts`.

```ts
interface Citation { slug: string; start: number; end: number }

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
}

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  error: ApiError | null
  send: (content: string) => Promise<void>
  stop: () => void
  editLast: (newContent: string) => Promise<void>
  newChat: () => void
  clearError: () => void
}
```

`AbortController` lives in a **module-level ref**, not in store state — avoids re-renders when only the abort handle changes. Components subscribe via selectors (`useShallow` where shape matters).

### Hook: `useChat` becomes a thin façade over the store

Existing call sites keep working:

```ts
export function useChat() {
  return useChatStore(useShallow(s => ({
    messages: s.messages, streaming: s.streaming, error: s.error,
    send: s.send, stop: s.stop, editLast: s.editLast, newChat: s.newChat,
  })))
}
```

### `send` flow

1. Append user msg + empty assistant placeholder.
2. Module-level `abortRef.current = new AbortController()`.
3. `fetch('/api/chat', { signal, body: JSON.stringify({ messages }) })`. `messages` excludes the empty assistant placeholder.
4. Parse SSE frames (keep the existing `parseSSEFrames` helper from `useChat.ts`).
5. Accumulate every token frame into a single `rawContent` buffer and append to the placeholder's `content`. **Do not** check for the citation marker per frame — it's almost always split across SSE frames (tokens are 1–4 chars; the marker is 14). The per-frame `token.includes('__CITATIONS__:')` check in today's code is a latent bug masked by test fixtures that emit the marker as one chunk.
6. Marker splitting happens at the **accumulated-message level**, not per frame:
   - After each append, if `rawContent` contains `__CITATIONS__:`, split at the **last** occurrence.
   - Left side → trim trailing whitespace/newlines → becomes the message's visible `content`.
   - Right side → parse comma-separated entries with `/^([\w-]+):(\d+)(?:-(\d+))?$/`. Missing end → `end = start`. Malformed entries skipped silently. Valid entries → `citations[]`.
   - Until the marker arrives, the last line of `content` may contain partial marker characters (e.g., `__CIT`) for 1–2 frames; acceptable MVP UX. A hold-back tail buffer (defer rendering the last 14 chars while streaming) is a future polish — not in scope.
7. **Invariant:** the assistant message's `content` field in the store never contains the `__CITATIONS__:` marker or anything after it — the split in step 6 strips it. History sent to `/api/chat` on subsequent turns therefore contains no citation markers, so the LLM never sees its own output format echoed back.
8. Stream end / abort / error → `streaming = false`.
9. On `AbortError` in `catch`, swallow silently (intentional user action).

### `stop` action

`abortRef.current?.abort()` → `fetch` rejects → `finally` clears `streaming`. Partial assistant text stays (choice 2a=ii). No visual "stopped" flag.

### `editLast` action

Precondition: not streaming, last user message exists. Slice messages up to (not including) the last user message, then call `send(newContent)` to re-append the edited user message + fresh assistant placeholder.

### `newChat` action

If streaming, `stop()` first. Reset `{ messages: [], streaming: false, error: null }`.

### Component changes

| Component | Change |
|---|---|
| `ChatPage` | Reads from `useChatStore`. Adds "New chat" button to the header (right side, disabled while streaming, no confirm). |
| `ChatInput` | Send button morphs into Stop while `streaming === true` (label + icon swap; click calls `stop()`). |
| `ChatMessage` | Renders citations via `<ReferenceChip>`. Footer label text reads **"References"**. For the last user message only: click anywhere on the bubble → enter edit mode (swap bubble for `<MessageEditor>`). |
| `MessageEditor` *(new)* | Inline textarea prefilled with the existing content; Save + Cancel buttons. Save → `editLast(newText)`. Bottom `ChatInput` disabled while editing. |
| `ReferenceChip` *(new)* | Hover/dblclick/single-click behavior per Section 4 below. |
| `PreviewPanel` *(new)* | Slide-in right-side panel; rendered once at `ChatPage` level. |
| `WikiPageViewer` | Extended `components` map attaches `data-source-line-start/end` to block elements. |
| `WikiPage` | Reads `?lines=` and calls `useWikiHighlight(contentRef, linesParam)`. |

### State: `usePreviewStore` (Zustand)

New file: `stores/previewStore.ts`.

```ts
interface PreviewState {
  active: Citation | null
  openPreview: (c: Citation) => void
  closePreview: () => void
}
```

Only one panel open at a time. Hovering a second chip cancels the first's timer and replaces `active`.

### `<ReferenceChip>` interactions

- `onMouseEnter` → `setTimeout(() => openPreview(citation), 2000)`.
- `onMouseLeave` → clear the open-timer; if panel is already open, schedule a 200ms close-timer (cancelled if mouse re-enters chip or panel).
- `onDoubleClick` → cancel open-timer, `closePreview()`, `navigate('/wiki/' + slug + '?lines=' + range)`.
- Single click → no-op (5a=i).

### `<PreviewPanel>` behavior

- **Position:** absolute, right edge of the chat column, full height of the message area. Width ~320px on desktop. On narrow viewports, full-width overlay.
- **Transition:** `translateX` + opacity, ~180ms ease.
- **Header:** `{slug} · lines {start}–{end}` (left), × close button (right), hint text "Double-click link to open page".
- **Body:** line-numbered source in `<pre>`. Render ±3 lines of context around the range; highlight cited lines with warm-yellow background (palette-aligned).

### Dismissal triggers (5b=iii — all three)

- **Esc** keydown on `document` → `closePreview()`.
- **Outside click** via `useOnClickOutside` wrapping panel ref (clicking a chip is not "outside").
- **Mouse-leave region** — chip + panel form one hover region; 200ms grace timer cancels on mouseenter to either.

### Wiki content cache (`lib/wikiCache.ts`)

```ts
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string>>()
export async function getWikiContent(slug: string): Promise<string> { ... }
```

Capacity unbounded for MVP (typical sessions hover <10 unique slugs). Bounded LRU is a trivial later swap.

### `useWikiHighlight(contentRef, linesParam)` hook

On mount and whenever `linesParam` or `contentRef` children change:

1. Parse `linesParam` with `/^(\d+)(?:-(\d+))?$/` → `{start, end}`. Malformed → bail.
2. Query `contentRef.current.querySelectorAll('[data-source-line-start]')`.
3. Filter elements whose `[elStart, elEnd]` range overlaps `[start, end]` — i.e., `elStart <= end && elEnd >= start`.
4. No match → scroll to top, no highlight.
5. First matched element → `scrollIntoView({ behavior: 'smooth', block: 'start' })`.
6. Add `.kb-highlight` to **all** matched elements.
7. After 5000ms (choice 5c=i with 5s override), add `.kb-highlight-fading` for ~600ms then remove both classes.
8. Cleanup on unmount / route change: clear the timer, strip the classes.

### Highlight styles (`src/styles/globals.css`)

```css
.kb-highlight {
  background-color: #fff7d9;
  transition: background-color 600ms ease-out;
  border-left: 2px solid #d4a05d;
  margin-left: -12px; padding-left: 10px;
}
.kb-highlight.kb-highlight-fading { background-color: transparent; }
```

### `WikiPageViewer` custom components

`react-markdown` v9 exposes the mdast `node` to custom components. Attach `data-source-line-start/end` via a `withLines(tag)` helper for block elements (`p`, `h1`–`h6`, `ul`, `ol`, `li`, `pre`, `blockquote`, `table`).

## Frontend tests

| File | Coverage |
|---|---|
| `stores/__tests__/chatStore.test.ts` | send/stop/editLast/newChat; AbortError swallowed; citation parsing (`slug:15-22`, `slug:30`, malformed); **marker deliberately split across multiple SSE frames** (e.g., `['__', 'CITATIONS', '__:', 'deploy-process:15-22']`) still parses correctly and `content` has no marker residue |
| `components/__tests__/ReferenceChip.test.tsx` | Label format; 2s hover opens panel; leaving before 2s cancels; dblclick navigates with `?lines=`; no-op single click |
| `components/__tests__/PreviewPanel.test.tsx` | Open/close via Esc / outside click / mouseleave region; line-numbered source with highlighted range; fetch dedup |
| `components/__tests__/MessageEditor.test.tsx` | Click last user bubble → editor; Save → `editLast`; Cancel → restore bubble |
| `hooks/__tests__/useWikiHighlight.test.ts` | Range-to-DOM mapping; 5s fade via `vi.useFakeTimers`; malformed / out-of-bounds → no crash |
| `components/__tests__/ChatMessage.test.tsx` | Updated "References" label + chip component assertions |

## Error-handling matrix

| Scenario | Behavior |
|---|---|
| LLM upstream error mid-stream | Existing `event: error` path → `ErrorBanner` |
| Empty / malformed `messages` payload | Backend 422 → `ErrorBanner` |
| User-initiated Stop (abort) | Catch `AbortError` silently; keep partial text; clear streaming; no error banner |
| LLM emits malformed `__CITATIONS__` entry | Skip that entry; valid ones still render |
| LLM omits `__CITATIONS__` entirely | Render body with no References section; no error |
| Hover preview: wiki fetch fails | "Unable to load preview" + retry |
| Hover preview: range out of bounds | Render available lines + hint; don't crash |
| `?lines=` doesn't overlap any block | Scroll to top silently — no toast |
| `editLast` while streaming | No-op (UI also disables the affordance) |
| `newChat` while streaming | `stop()` first, then reset |
| Concurrent `send` | Defensive `if (streaming) return` guard |

## Dependencies added

- `zustand` (~1 KB gzipped).

No other runtime deps. `react-markdown` already present — only a config change.

## Rollout / migration

- **No DB or disk migrations** — all new state lives in-memory or in-browser.
- **Breaking API changes** (request shape `{question}` → `{messages}`; `__CITATIONS__` entry format `slug` → `slug:start-end`) — but single-caller (our frontend), same deploy. No feature flags needed.

## Tradeoffs captured

These decisions were made with alternatives considered; recording them here so future readers don't re-relitigate them without new information.

### Citation pipeline: Approach 1 (frontend parses) over Approach 2 (server-side citation events) or Approach 3 (two-pass LLM)

- **Approach 1** was chosen: smaller backend diff, single source-of-truth for wiki content is the existing `GET /api/wiki/:slug` endpoint.
- **Approach 2** (backend emits structured `event: citation` with pre-sliced snippets) would give instant preview on hover (no fetch), but duplicates "what a reference looks like" in two places and costs meaningful backend code for a UX win mostly absorbed by the existing 2-second hover delay.
- **Approach 3** (two LLM calls — one for answer, one for structured citations) doubles cost and latency; the answer-time citation emission works reliably enough with a clear prompt.

### Phase 1 context window: last 2–3 turns over full history

- Full history to the retriever (what ChatGPT/Claude do for answer generation) is wasteful and noisy at the retrieval step.
- Last 2–3 turns matches LangChain's default `ConversationalRetrievalChain` behavior — enough for anaphora resolution, cheap to run.
- Constant `SELECT_HISTORY_TURNS = 3` is tunable if follow-up resolution degrades.

### Memory scope: session-only (Option A) over persistent (B) or multi-session (C)

- Deliberate "start simple" call. Zustand shape migrates cleanly later — the outer `messages` slot becomes `conversations: Record<Id, Conversation>` with ~30 LOC of diff + an `activeId` + CRUD actions. `persist` middleware drops in for localStorage.

### Edit scope: last user message only (narrowing of II)

- Full II (any prior user message replaceable) was also viable but the user's phrasing ("edit the message before submit it again") and the simplicity bias pointed to narrowing.
- III (branching) was ~3× the effort and couples the memory refactor to a tree data model.

### Anchor strategy: source line numbers over text snippets or heading-offset

- Source lines are most precise; the known risk is LLM miscounts. Mitigated by: (1) line-numbered page content in the system message, (2) explicit "never invent line numbers" instruction, (3) frontend graceful fallback on out-of-bounds / no-match (scroll to top, silently).
- Text-snippet anchoring would sidestep LLM counting but feel less natural for "highlight these lines" semantics.

### State management: Zustand over Redux Toolkit

- Bundle: Zustand ~1 KB vs RTK ~12 KB.
- Boilerplate: Zustand has a single `create()` call, no `<Provider>` wrap; RTK needs slices + store config + Provider.
- Re-render control: both support selector subscriptions; Zustand's `useShallow` keeps token-stream re-renders tight.
- RTK's strengths (devtools, middleware ecosystem, multi-slice scale) aren't exercised here.
- Multi-session migration is straightforward in Zustand (slices pattern + `persist` middleware).

### Preview placement: slide-in side panel (Option B) over floating popover (A) or centered card (C)

- Shows actual line numbers in the preview, making the "cite lines 15–22" connection explicit.
- Gives room for context without covering the assistant reply.

### Message-level marker splitting over per-frame detection

The current code checks `token.includes('__CITATIONS__:')` per SSE frame. Tokens stream 1–4 chars at a time; the marker is 14 chars. In production it will split across frames and fail to parse. Existing tests happen to pass only because fixtures emit the marker as one chunk. The spec fixes this by accumulating content first and splitting on the last `__CITATIONS__:` occurrence at the message level — with a mandatory test that deliberately splits the marker across frames. A hold-back tail buffer to hide partial-marker characters during streaming is deferred.

### Block-level highlight over character-precision

- `react-markdown`'s `position` is block-granular; sub-block highlighting would require walking text nodes and substring-matching, ~4× the code for marginal UX gain. Revisit only if users report "highlight is too coarse."

### Unbounded wiki cache (MVP) over LRU

- Typical hover counts per session are small (<10 unique slugs). LRU is a trivial later swap.

### Whole-page fetch on hover over a new `/snippet` endpoint

- Same source-of-truth as the wiki viewer; avoids a new backend surface. Costs slightly more bandwidth on first hover for a given slug; zero after cache.

### Panel as overlay (not layout shift)

- Matches the "preview layer on top of current chat" phrasing in the original request.
- Simpler responsive behavior; no reflow of the chat column.

### Preview dismissal: all three triggers (5b=iii)

- Mouse-leave-region, outside click, and Esc all close. Generous because hover-opened UI that's hard to dismiss is frustrating.
