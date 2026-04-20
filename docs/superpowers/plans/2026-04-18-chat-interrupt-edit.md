# Chat Interrupt & Edit-Last Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users stop a streaming reply (keeping any partial text), edit the last user message and re-submit, and start a new conversation from the chat header.

**Architecture:** All changes are frontend-only, extending the `useChatStore` created in the chat-foundation plan. Stop uses the existing module-level `AbortController` and swallows `AbortError`. Edit-last truncates the thread to the pre-last-user slice and re-invokes `send`. "New chat" stops any in-flight stream and resets the store. The Send button in `ChatInput` morphs into Stop while `streaming === true`. The last user bubble becomes click-to-edit via a new `<MessageEditor>` component.

**Tech Stack:** React 19, Zustand v5, Vitest + RTL.

**Spec reference:** `docs/superpowers/specs/2026-04-18-chat-harness-design.md` — feature F2 (§ 3.4–3.6, § 3.7 component changes for `ChatInput` / `ChatMessage` / `MessageEditor` / `ChatPage` "New chat" header).

**Working branch:** Suggested `git checkout -b feature/chat-interrupt-edit` — branch from `main` after the chat-foundation plan is merged.

**Depends on:** `2026-04-18-chat-foundation.md` (store + façade must exist; `abortRef` must be wired into `send`).

---

## File Structure

### Modified frontend files
- `frontend/src/stores/chatStore.ts` — add `stop`, `editLast`, `newChat` actions.
- `frontend/src/stores/__tests__/chatStore.test.ts` — stop / editLast / newChat tests.
- `frontend/src/hooks/useChat.ts` — expose the new actions through the façade.
- `frontend/src/components/ChatInput.tsx` — morph Send→Stop based on `streaming`.
- `frontend/src/components/ChatMessage.tsx` — click-to-edit on the last user bubble.
- `frontend/src/pages/ChatPage.tsx` — pass `isLastUserMessage` into `<ChatMessage>`, add "New chat" button to header.

### New frontend files
- `frontend/src/components/MessageEditor.tsx` — inline textarea + Save/Cancel buttons.
- `frontend/src/components/__tests__/MessageEditor.test.tsx`
- `frontend/src/components/__tests__/ChatInput.test.tsx` — Send↔Stop morph tests.

---

## Phase 1 — Store actions

### Task 1: `stop` action

**Files:**
- Modify: `frontend/src/stores/chatStore.ts`
- Modify: `frontend/src/stores/__tests__/chatStore.test.ts`

- [ ] **Step 1: Write failing test**

Append to `chatStore.test.ts`:

```ts
describe('useChatStore.stop', () => {
  it('aborts the in-flight stream and preserves partial text', async () => {
    // Infinite stream that never completes on its own.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: Partial\r\n\r\n'))
        // Don't close — simulates an ongoing answer.
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        resolve({ ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response)
      })
    }))

    const sendPromise = useChatStore.getState().send('hi')
    // Let the first frame flush into state.
    await new Promise(r => setTimeout(r, 20))
    useChatStore.getState().stop()
    await sendPromise

    const { messages, streaming } = useChatStore.getState()
    expect(streaming).toBe(false)
    expect(messages[messages.length - 1].content).toContain('Partial')
  })
})
```

- [ ] **Step 2: Run — verify failure**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: FAIL — `stop` is not defined.

- [ ] **Step 3: Implement `stop`**

Edit `frontend/src/stores/chatStore.ts`. Extend the `ChatState` interface and the `create` body:

```ts
interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  error: ApiError | null
  send: (content: string) => Promise<void>
  stop: () => void
  clearError: () => void
}

// Inside create(...):
stop: () => {
  abortRef.current?.abort()
},
```

- [ ] **Step 4: Run — verify pass**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: all tests PASS. In particular, the partial-content-preserved assertion holds because the foundation-plan `send` swallows `AbortError` and does NOT clear assistant content in that branch.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/chatStore.ts frontend/src/stores/__tests__/chatStore.test.ts
git commit -m "feat(store): stop() aborts stream, preserves partial text"
```

### Task 2: `editLast` action

**Files:**
- Modify: `frontend/src/stores/chatStore.ts`
- Modify: `frontend/src/stores/__tests__/chatStore.test.ts`

- [ ] **Step 1: Write failing test**

Append to `chatStore.test.ts`:

```ts
describe('useChatStore.editLast', () => {
  it('truncates to before the last user message and re-sends', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(['Old answer.']))
      .mockResolvedValueOnce(makeSSEResponse(['New answer.']))
    vi.stubGlobal('fetch', fetchMock)

    await useChatStore.getState().send('first question')
    await useChatStore.getState().editLast('edited question')

    const { messages } = useChatStore.getState()
    // Should be exactly one user + one assistant pair after the edit.
    expect(messages).toHaveLength(2)
    expect(messages[0].content).toBe('edited question')
    expect(messages[1].content).toBe('New answer.')
  })

  it('no-ops while streaming', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSSEResponse(['Answer.'])))
    const sendPromise = useChatStore.getState().send('q')
    await useChatStore.getState().editLast('x')
    await sendPromise
    // Messages should reflect only the single send, not the edit.
    const { messages } = useChatStore.getState()
    expect(messages[0].content).toBe('q')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: FAIL — `editLast` undefined.

- [ ] **Step 3: Implement `editLast`**

Extend `ChatState` and `create`:

```ts
editLast: async (newContent: string) => {
  if (get().streaming) return
  const msgs = get().messages
  // Find the last user message index.
  let lastUserIdx = -1
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user') { lastUserIdx = i; break }
  }
  if (lastUserIdx < 0) return
  set({ messages: msgs.slice(0, lastUserIdx) })
  await get().send(newContent)
},
```

- [ ] **Step 4: Run to verify pass**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: both editLast tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/chatStore.ts frontend/src/stores/__tests__/chatStore.test.ts
git commit -m "feat(store): editLast truncates thread and re-sends"
```

### Task 3: `newChat` action

**Files:**
- Modify: `frontend/src/stores/chatStore.ts`
- Modify: `frontend/src/stores/__tests__/chatStore.test.ts`

- [ ] **Step 1: Write failing test**

Append:

```ts
describe('useChatStore.newChat', () => {
  it('resets messages and error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeSSEResponse(['Answer.'])))
    await useChatStore.getState().send('q')
    useChatStore.setState({ error: new ApiError({
      code: 'x', message: 'y', requestId: null, status: 500,
    }) })
    useChatStore.getState().newChat()
    const { messages, error, streaming } = useChatStore.getState()
    expect(messages).toEqual([])
    expect(error).toBeNull()
    expect(streaming).toBe(false)
  })

  it('stops a streaming send before clearing', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: Partial\r\n\r\n'))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        resolve({ ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response)
      })
    }))

    const sendPromise = useChatStore.getState().send('hi')
    await new Promise(r => setTimeout(r, 10))
    useChatStore.getState().newChat()
    await sendPromise
    expect(useChatStore.getState().messages).toEqual([])
  })
})
```

You'll need to import `ApiError` in the test file: `import { ApiError } from '../../lib/api'`.

- [ ] **Step 2: Implement `newChat`**

Extend the store:

```ts
newChat: () => {
  if (get().streaming) abortRef.current?.abort()
  set({ messages: [], streaming: false, error: null })
},
```

- [ ] **Step 3: Run**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: all tests PASS.

- [ ] **Step 4: Expose via façade**

Edit `frontend/src/hooks/useChat.ts`:

```ts
export function useChat() {
  return useChatStore(useShallow(s => ({
    messages: s.messages,
    streaming: s.streaming,
    error: s.error,
    sendMessage: s.send,
    stop: s.stop,
    editLast: s.editLast,
    newChat: s.newChat,
  })))
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/chatStore.ts frontend/src/stores/__tests__/chatStore.test.ts frontend/src/hooks/useChat.ts
git commit -m "feat(store): newChat resets thread, stops any in-flight stream"
```

---

## Phase 2 — UI: Stop morph, MessageEditor, New chat button

### Task 4: Send button morphs into Stop while streaming

**Files:**
- Modify: `frontend/src/components/ChatInput.tsx`
- Create: `frontend/src/components/__tests__/ChatInput.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/ChatInput.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatInput } from '../ChatInput'

describe('ChatInput', () => {
  it('shows Send by default', () => {
    render(<ChatInput onSend={() => {}} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  it('morphs into Stop while streaming', () => {
    const onStop = vi.fn()
    render(<ChatInput onSend={() => {}} streaming onStop={onStop} />)
    const btn = screen.getByRole('button', { name: /stop/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('Stop button is enabled even when textarea is empty', () => {
    render(<ChatInput onSend={() => {}} streaming onStop={() => {}} />)
    expect(screen.getByRole('button', { name: /stop/i })).not.toBeDisabled()
  })
})
```

- [ ] **Step 2: Run — verify failure**

Run: `cd frontend && pnpm test src/components/__tests__/ChatInput.test.tsx`
Expected: FAIL — `streaming` and `onStop` props don't exist.

- [ ] **Step 3: Update `ChatInput`**

Replace `frontend/src/components/ChatInput.tsx`:

```tsx
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  onStop?: () => void
  streaming?: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, onStop, streaming = false, disabled = false }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled || streaming) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const showStop = streaming && !!onStop

  return (
    <div className="flex gap-2 items-end bg-ivory border border-border-warm rounded-xl px-3 sm:px-4 py-2 shadow-whisper">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your team's knowledge…"
        rows={1}
        disabled={disabled || streaming}
        autoComplete="off"
        className="flex-1 min-w-0 resize-none max-h-48 overflow-y-auto bg-transparent text-base md:text-sm text-near-black placeholder:text-warm-silver outline-none font-sans leading-relaxed"
      />
      {showStop ? (
        <button
          onClick={onStop}
          aria-label="Stop"
          className="bg-near-black text-ivory text-sm font-medium font-sans px-4 min-h-11 md:min-h-0 md:py-1.5 rounded-lg hover:opacity-90 transition-opacity"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="bg-terracotta text-ivory text-sm font-medium font-sans px-4 min-h-11 md:min-h-0 md:py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Send
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd frontend && pnpm test src/components/__tests__/ChatInput.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire it up in `ChatPage`**

Edit `frontend/src/pages/ChatPage.tsx`, replace the `<ChatInput>` line:

```tsx
<ChatInput onSend={sendMessage} streaming={streaming} onStop={stop} />
```

Also destructure `stop` from `useChat()`:

```tsx
const { messages, streaming, sendMessage, stop, newChat, error } = useChat()
```

Remove the existing "Thinking…" spinner block — the Stop button is now the streaming affordance.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatInput.tsx frontend/src/components/__tests__/ChatInput.test.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat(chat): Send button morphs into Stop while streaming"
```

### Task 5: MessageEditor component

**Files:**
- Create: `frontend/src/components/MessageEditor.tsx`
- Create: `frontend/src/components/__tests__/MessageEditor.test.tsx`

- [ ] **Step 1: Write failing test**

Create `frontend/src/components/__tests__/MessageEditor.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MessageEditor } from '../MessageEditor'

describe('MessageEditor', () => {
  it('prefills textarea with initial content', () => {
    render(<MessageEditor initial="hi" onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('hi')
  })

  it('Save invokes onSave with trimmed value', () => {
    const onSave = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  updated  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith('updated')
  })

  it('Cancel invokes onCancel, not onSave', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Save disabled when value is blank', () => {
    render(<MessageEditor initial="" onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Implement `MessageEditor`**

Create `frontend/src/components/MessageEditor.tsx`:

```tsx
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
}

export function MessageEditor({ initial, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className="w-full bg-ivory border border-border-warm rounded-lg p-2 text-sm font-sans text-near-black resize-none outline-none focus:border-terracotta"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm font-sans text-stone-gray hover:text-near-black px-3 py-1 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!value.trim()}
          className="bg-terracotta text-ivory text-sm font-medium font-sans px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run**

Run: `cd frontend && pnpm test src/components/__tests__/MessageEditor.test.tsx`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MessageEditor.tsx frontend/src/components/__tests__/MessageEditor.test.tsx
git commit -m "feat(chat): MessageEditor component for editing last user message"
```

### Task 6: Click-to-edit on the last user bubble

**Files:**
- Modify: `frontend/src/components/ChatMessage.tsx`
- Modify: `frontend/src/components/__tests__/ChatMessage.test.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Write failing test**

Extend `frontend/src/components/__tests__/ChatMessage.test.tsx`. Add:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { ChatMessage } from '../ChatMessage'

it('enters edit mode when the last user bubble is clicked', () => {
  const msg = { id: '1', role: 'user' as const, content: 'hi', citations: [] }
  render(<ChatMessage message={msg} editable onEditSave={() => {}} />)
  fireEvent.click(screen.getByText('hi'))
  expect(screen.getByRole('textbox')).toHaveValue('hi')
})

it('does not enter edit mode when not editable', () => {
  const msg = { id: '1', role: 'user' as const, content: 'hi', citations: [] }
  render(<ChatMessage message={msg} />)
  fireEvent.click(screen.getByText('hi'))
  expect(screen.queryByRole('textbox')).toBeNull()
})
```

- [ ] **Step 2: Update `ChatMessage`**

Replace `frontend/src/components/ChatMessage.tsx`:

```tsx
import { useState } from 'react'
import type { ChatMessage as ChatMessageType } from '../lib/types'
import { MessageEditor } from './MessageEditor'

interface Props {
  message: ChatMessageType
  editable?: boolean
  onEditSave?: (text: string) => void
}

export function ChatMessage({ message, editable = false, onEditSave }: Props) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)

  const canEdit = isUser && editable && !!onEditSave

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium font-sans ${
          isUser
            ? 'bg-warm-sand text-charcoal-warm'
            : 'bg-terracotta text-ivory'
        }`}
      >
        {isUser ? 'U' : 'K'}
      </div>

      <div
        className={`min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-prose rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-sm leading-relaxed font-sans shadow-whisper ${
          isUser
            ? 'bg-near-black text-ivory rounded-tr-sm'
            : 'bg-ivory border border-border-cream text-near-black rounded-tl-sm'
        } ${canEdit && !editing ? 'cursor-pointer hover:opacity-90' : ''}`}
        onClick={() => { if (canEdit && !editing) setEditing(true) }}
        role={canEdit && !editing ? 'button' : undefined}
        tabIndex={canEdit && !editing ? 0 : undefined}
      >
        {editing && onEditSave ? (
          <MessageEditor
            initial={message.content}
            onSave={(text) => { onEditSave(text); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        ) : !isUser && message.content === '' ? (
          <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}

        {!editing && message.citations.length > 0 && (
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

- [ ] **Step 3: Wire into `ChatPage`**

Edit `frontend/src/pages/ChatPage.tsx`. Compute the index of the last user message once per render:

```tsx
const lastUserIdx = (() => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i
  }
  return -1
})()
```

Destructure `editLast` from `useChat()`:

```tsx
const { messages, streaming, sendMessage, stop, newChat, editLast, error } = useChat()
```

In the map, pass `editable` + `onEditSave`:

```tsx
{messages.map((msg, idx) => (
  <ChatMessage
    key={msg.id}
    message={msg}
    editable={!streaming && idx === lastUserIdx}
    onEditSave={editLast}
  />
))}
```

- [ ] **Step 4: Run**

Run: `cd frontend && pnpm test`
Expected: all tests PASS, including `ChatMessage` edit tests and the `chatStore` suite.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatMessage.tsx frontend/src/components/__tests__/ChatMessage.test.tsx frontend/src/pages/ChatPage.tsx
git commit -m "feat(chat): click last user bubble to edit and resubmit"
```

### Task 7: "New chat" button in the chat panel header

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx`

- [ ] **Step 1: Add the button**

Edit `frontend/src/pages/ChatPage.tsx`. Replace the header block:

```tsx
<div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border-cream flex items-start justify-between gap-3">
  <div>
    <h1 className="font-serif text-lg sm:text-xl font-medium text-near-black leading-tight">
      Ask the knowledge base
    </h1>
    <p className="text-xs text-stone-gray font-sans mt-0.5">Powered by LLM Wiki</p>
  </div>
  <button
    onClick={newChat}
    disabled={streaming || messages.length === 0}
    className="text-xs font-sans text-stone-gray hover:text-near-black px-2 py-1 rounded border border-border-cream disabled:opacity-40 disabled:cursor-not-allowed"
  >
    New chat
  </button>
</div>
```

- [ ] **Step 2: Manual smoke**

Run: `pnpm dev` from repo root. Send a message. While it streams, confirm:
- Send button shows **Stop**; clicking Stop stops the stream and keeps the partial reply.
- After streaming ends, click the last user bubble; confirm the editor appears with the text prefilled.
- Change the text, Save → a fresh reply arrives and the previous reply is gone.
- Click "New chat" → all messages cleared.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/ChatPage.tsx
git commit -m "feat(chat): New chat button clears the thread"
```

---

## Verification

- [ ] **Frontend tests:** `cd frontend && pnpm test` — all green.
- [ ] **Frontend build:** `cd frontend && pnpm build` — succeeds.
- [ ] **Manual:** Stop + partial preservation works. Edit-last replaces the tail. New chat clears.
- [ ] **Edit guardrail:** While streaming, clicking the last user bubble does NOT enter edit mode (affordance hidden via `editable={!streaming && …}`).

## Self-review checklist

- [ ] Stop button only appears while `streaming === true`.
- [ ] `editLast` is a no-op while streaming (test covers this).
- [ ] `newChat` aborts any in-flight stream before clearing (test covers this).
- [ ] 7 commits on this branch (1 per task).
