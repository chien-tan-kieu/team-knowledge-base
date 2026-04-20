# Chat Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat stateful across route navigation within a session, swap the `/api/chat` contract from `{question}` to `{messages[]}`, and fix the latent SSE-marker-split bug.

**Architecture:** Backend changes `ChatRequest` and `QueryAgent.query` to accept a conversation history. Phase 1 (page selection) receives the last 3 turns; Phase 2 (answer) receives the full history. Frontend introduces a Zustand store (`useChatStore`) that owns messages, streaming state, and the `send` action. `useChat` becomes a thin façade so existing call sites keep compiling. The SSE marker (`__CITATIONS__:`) is split at the accumulated-message level, not per frame — fixing a bug latent in the current per-token `includes()` check.

**Tech Stack:** Backend — FastAPI 0.128, Pydantic, pytest (`asyncio_mode=auto`), LiteLLM. Frontend — React 19, Zustand v5 (new), Vitest + RTL.

**Spec reference:** `docs/superpowers/specs/2026-04-18-chat-harness-design.md` — feature F1 (§ "Backend changes" 2.1–2.4, § "Frontend changes: State / Hook / send flow"). No stop/edit/newChat yet (those ship in the interrupt-edit plan).

**Working branch:** Suggested `git checkout -b feature/chat-foundation`.

**Depends on:** none. This plan blocks the other two chat plans.

---

## File Structure

### Modified backend files
- `backend/kb/wiki/models.py` — replace `ChatRequest { question }` with `ChatRequest { messages: list[ChatTurn] }`; add `ChatTurn` model.
- `backend/kb/api/chat.py` — update validator, pass `request.messages` to `QueryAgent.query`, catch `asyncio.CancelledError` explicitly.
- `backend/kb/agents/query.py` — new `query(messages)` signature, `SELECT_HISTORY_TURNS=3`, line-numbered-pages-free Phase 2 (still bare-slug `__CITATIONS__` for now — citation upgrade is in the ranged-citations plan).
- `backend/tests/test_api_chat.py` — rewrite fixtures for new contract; validation tests.
- `backend/tests/test_query_agent.py` — update mocks; add multi-turn test.

### New frontend files
- `frontend/src/stores/chatStore.ts` — Zustand store: `messages`, `streaming`, `error`, `send`, `clearError`. Module-level `abortRef` (populated but not exposed to store state — stop action is in the next plan).
- `frontend/src/stores/__tests__/chatStore.test.ts` — send/receive, multi-turn payload, **split-marker test**.

### Modified frontend files
- `frontend/package.json` — add `zustand` dep.
- `frontend/src/lib/types.ts` — extend `ChatMessage` with `citations: string[]` (unchanged shape for now — upgraded in ranged-citations plan).
- `frontend/src/lib/api.ts` — `startChat(messages, signal?)` new signature.
- `frontend/src/hooks/useChat.ts` — becomes a thin Zustand façade.
- `frontend/src/hooks/__tests__/useChat.test.ts` — mock fetch around store; update call signatures.

---

## Phase 1 — Backend: contract + multi-turn agent

### Task 1: Add `ChatTurn` model and new `ChatRequest` shape

**Files:**
- Modify: `backend/kb/wiki/models.py`

- [ ] **Step 1: Write a failing model test**

Create/extend `backend/tests/test_models.py` (file already exists — append). Add:

```python
from pydantic import ValidationError
import pytest
from kb.wiki.models import ChatRequest, ChatTurn


def test_chat_request_accepts_messages_list():
    req = ChatRequest(messages=[
        ChatTurn(role="user", content="hi"),
        ChatTurn(role="assistant", content="hello"),
        ChatTurn(role="user", content="again"),
    ])
    assert len(req.messages) == 3
    assert req.messages[0].role == "user"


def test_chat_turn_rejects_invalid_role():
    with pytest.raises(ValidationError):
        ChatTurn(role="system", content="x")
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_models.py -v`
Expected: FAIL — `ChatTurn` / `messages` not defined.

- [ ] **Step 3: Implement models**

Edit `backend/kb/wiki/models.py`. Replace the existing `ChatRequest` with:

```python
from typing import Literal

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatTurn]
```

Keep the existing `from enum import StrEnum` and `from pydantic import BaseModel` imports.

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && .venv/bin/pytest tests/test_models.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/wiki/models.py backend/tests/test_models.py
git commit -m "feat(models): ChatRequest accepts list of ChatTurn"
```

### Task 2: Validate `messages` in the chat endpoint

**Files:**
- Modify: `backend/kb/api/chat.py`

- [ ] **Step 1: Write failing validation test**

Edit `backend/tests/test_api_chat.py`. Replace the existing tests and add these:

```python
def test_chat_rejects_empty_messages(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": []})
    assert response.status_code == 422


def test_chat_rejects_blank_content(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": [
        {"role": "user", "content": "   "},
    ]})
    assert response.status_code == 422


def test_chat_rejects_non_user_last_turn(client):
    tc, _ = client
    response = tc.post("/api/chat", json={"messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "hello"},
    ]})
    assert response.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_api_chat.py -v`
Expected: FAILs on contract mismatch.

- [ ] **Step 3: Update validator in `chat.py`**

Replace the `ValidatedChatRequest` class and the `chat` handler signature in `backend/kb/api/chat.py`:

```python
from pydantic import model_validator

class ValidatedChatRequest(ChatRequest):
    @model_validator(mode="after")
    def validate_shape(self):
        if not self.messages:
            raise ValueError("messages must not be empty")
        if self.messages[-1].role != "user":
            raise ValueError("last message must have role=user")
        for m in self.messages:
            if not m.content.strip():
                raise ValueError("content must not be blank")
        return self
```

The handler signature stays the same — `request: ValidatedChatRequest` — but Pydantic now runs the new model validator.

- [ ] **Step 4: Run the new validator tests**

Run: `cd backend && .venv/bin/pytest tests/test_api_chat.py::test_chat_rejects_empty_messages tests/test_api_chat.py::test_chat_rejects_blank_content tests/test_api_chat.py::test_chat_rejects_non_user_last_turn -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/kb/api/chat.py backend/tests/test_api_chat.py
git commit -m "feat(api): validate {messages} contract on /api/chat"
```

### Task 3: Update `QueryAgent.query` to accept messages

**Files:**
- Modify: `backend/kb/agents/query.py`
- Modify: `backend/tests/test_query_agent.py`

- [ ] **Step 1: Write failing multi-turn test**

Replace the top of `backend/tests/test_query_agent.py` with:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from kb.agents.query import QueryAgent, SELECT_HISTORY_TURNS
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS


def _make_streaming_mock(tokens: list[str]):
    async def _aiter(self=None):
        for token in tokens:
            chunk = MagicMock()
            chunk.choices[0].delta.content = token
            yield chunk

    mock = AsyncMock()
    mock.__aiter__ = _aiter
    return mock


@pytest.mark.asyncio
async def test_query_takes_messages_list(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "Run make deploy.")
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        tokens = []
        async for t in agent.query([
            {"role": "user", "content": "How do I deploy?"},
            {"role": "assistant", "content": "Run make deploy."},
            {"role": "user", "content": "Tell me more."},
        ]):
            tokens.append(t)

    # Phase 2 call (second call) should include the full conversation as chat turns
    phase2_kwargs = mock_llm.call_args_list[1].kwargs
    roles = [m["role"] for m in phase2_kwargs["messages"]]
    # system + the 3 chat turns
    assert roles[0] == "system"
    assert roles[1:] == ["user", "assistant", "user"]


@pytest.mark.asyncio
async def test_phase1_uses_last_n_turns(knowledge_dir):
    fs = WikiFS(knowledge_dir)
    fs.write_page("deploy-process", "x")
    fs.write_index("- [[deploy-process]]\n")

    select_response = MagicMock()
    select_response.choices[0].message.content = "deploy-process"
    stream_mock = _make_streaming_mock(["ok"])

    long_history = [
        {"role": "user", "content": f"q{i}"} if i % 2 == 0
        else {"role": "assistant", "content": f"a{i}"}
        for i in range(10)
    ]
    # Ensure last turn is user
    long_history.append({"role": "user", "content": "latest"})

    with patch("litellm.acompletion", new=AsyncMock(side_effect=[select_response, stream_mock])) as mock_llm:
        agent = QueryAgent(fs=fs, model="claude-sonnet-4-6")
        async for _ in agent.query(long_history):
            pass

    phase1_prompt = mock_llm.call_args_list[0].kwargs["messages"][0]["content"]
    # Only the tail should appear
    assert "latest" in phase1_prompt
    # Earlier turns should be absent
    assert "q0" not in phase1_prompt
```

- [ ] **Step 2: Run — verify failure**

Run: `cd backend && .venv/bin/pytest tests/test_query_agent.py::test_query_takes_messages_list -v`
Expected: FAIL — query still takes a single string.

- [ ] **Step 3: Update `QueryAgent.query` signature + prompt flow**

Replace `backend/kb/agents/query.py` with:

```python
from typing import AsyncIterator
import logging
import litellm
from kb.errors import LLMUpstreamError
from kb.wiki.fs import WikiFS

logger = logging.getLogger(__name__)

SELECT_HISTORY_TURNS = 3

SELECT_PROMPT = """You are a knowledge base search assistant.

Given the index below and the recent conversation, return ONLY the slugs of the most relevant wiki pages (comma-separated, max 5). No explanation.

INDEX:
{index}

RECENT CONVERSATION:
{history}

Respond with slugs only, e.g.: deploy-process, database-migrations"""


ANSWER_SYSTEM_PROMPT = """You are a helpful knowledge base assistant. Answer using ONLY the wiki pages provided.

WIKI PAGES:
{pages}

At the very end of your response, on its own final line, append:
__CITATIONS__:slug-one,slug-two
listing all slugs you drew from."""


def _format_history(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m["role"].upper()
        lines.append(f"{role}: {m['content']}")
    return "\n".join(lines)


class QueryAgent:
    def __init__(self, fs: WikiFS, model: str) -> None:
        self._fs = fs
        self._model = model

    async def query(self, messages: list[dict]) -> AsyncIterator[str]:
        index = self._fs.read_index()
        recent = messages[-SELECT_HISTORY_TURNS:]

        # Phase 1: select relevant pages
        try:
            select_response = await litellm.acompletion(
                model=self._model,
                messages=[{
                    "role": "user",
                    "content": SELECT_PROMPT.format(index=index, history=_format_history(recent)),
                }],
            )
        except Exception as exc:
            logger.error("llm.select_failed")
            raise LLMUpstreamError() from exc

        slugs_raw = select_response.choices[0].message.content.strip()
        slugs = [s.strip() for s in slugs_raw.split(",") if s.strip()]

        # Phase 2: read selected pages
        pages_content = ""
        for slug in slugs:
            try:
                page = self._fs.read_page(slug)
                pages_content += f"\n--- {slug} ---\n{page.content}\n"
            except FileNotFoundError:
                pass

        if not pages_content:
            yield "I couldn't find relevant information in the knowledge base."
            return

        system_message = {
            "role": "system",
            "content": ANSWER_SYSTEM_PROMPT.format(pages=pages_content),
        }
        chat_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

        # Phase 3: stream the answer
        try:
            stream = await litellm.acompletion(
                model=self._model,
                messages=[system_message, *chat_messages],
                stream=True,
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    yield token
        except LLMUpstreamError:
            raise
        except Exception as exc:
            logger.error("llm.answer_failed")
            raise LLMUpstreamError() from exc
```

- [ ] **Step 4: Update existing tests in `test_query_agent.py` that still pass a string**

The original three tests (`test_query_streams_answer`, `test_query_returns_citations`, `test_query_agent_wraps_litellm_errors`) call `agent.query("…")`. Convert each call:

```python
async for token in agent.query([{"role": "user", "content": "How do I deploy?"}]):
```

Do this in all three existing tests.

- [ ] **Step 5: Run full query-agent suite**

Run: `cd backend && .venv/bin/pytest tests/test_query_agent.py -v`
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/kb/agents/query.py backend/tests/test_query_agent.py
git commit -m "feat(agent): query(messages[]) with last-N Phase 1 + full-history Phase 2"
```

### Task 4: Pass `request.messages` through the endpoint + handle cancellation

**Files:**
- Modify: `backend/kb/api/chat.py`

- [ ] **Step 1: Write failing cancellation-not-logged test**

Append to `backend/tests/test_api_chat.py`:

```python
import asyncio
import logging


async def _mock_query_cancelled(messages):
    yield "partial "
    raise asyncio.CancelledError()


def test_chat_does_not_log_error_on_client_cancellation(client, caplog):
    tc, _ = client
    with caplog.at_level(logging.ERROR, logger="kb.api.chat"):
        with patch("kb.api.chat.QueryAgent") as MockAgent:
            MockAgent.return_value.query = _mock_query_cancelled
            with tc.stream("POST", "/api/chat", json={"messages": [
                {"role": "user", "content": "hi"}
            ]}) as resp:
                # Drain at least one byte, then close.
                for _ in resp.iter_bytes():
                    break
    # Endpoint must not log CancelledError as an error.
    assert not any("chat.stream_failed" in r.message for r in caplog.records)
```

- [ ] **Step 2: Update the handler to pass messages + catch cancellation**

Replace the handler in `backend/kb/api/chat.py`:

```python
import asyncio
# ... existing imports ...

@router.post("")
async def chat(
    request: ValidatedChatRequest,
    fs: WikiFS = Depends(get_wiki_fs),
):
    agent = QueryAgent(fs=fs, model=settings.llm_model)

    async def event_generator():
        try:
            async for token in agent.query([m.model_dump() for m in request.messages]):
                yield {"data": token}
        except asyncio.CancelledError:
            raise
        except LLMUpstreamError as exc:
            logger.warning("chat.stream_llm_error")
            yield _error_event(ErrorCode.UPSTREAM_LLM_ERROR, exc.message)
        except Exception:
            logger.exception("chat.stream_failed")
            yield _error_event(ErrorCode.INTERNAL_ERROR, "Stream failed. Please try again.")

    return EventSourceResponse(event_generator())
```

- [ ] **Step 3: Run full api_chat suite**

Run: `cd backend && .venv/bin/pytest tests/test_api_chat.py -v`
Expected: all PASS (including the existing SSE-stream and error-event tests that now send `{messages}`).

Existing tests still passing `{"question": "…"}` need conversion: wherever you see `json={"question": "..."}`, convert to `json={"messages": [{"role": "user", "content": "..."}]}`. Do this for all tests in the file.

Run again after conversions.

- [ ] **Step 4: Commit**

```bash
git add backend/kb/api/chat.py backend/tests/test_api_chat.py
git commit -m "feat(api): route {messages} into QueryAgent, suppress CancelledError log"
```

---

## Phase 2 — Frontend: Zustand store + façade hook

### Task 5: Add `zustand` dependency

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Add dep**

Edit `frontend/package.json`. In `"dependencies"`, add:

```json
"zustand": "^5.0.12",
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: zustand added to `pnpm-lock.yaml`.

- [ ] **Step 3: Smoke-test**

Run: `cd frontend && pnpm build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json pnpm-lock.yaml
git commit -m "chore(frontend): add zustand"
```

### Task 6: Update `lib/api.ts::startChat` to take messages + signal

**Files:**
- Modify: `frontend/src/lib/api.ts`

- [ ] **Step 1: Update signature**

Replace the `startChat` function:

```ts
import type { ChatMessage } from './types'

/**
 * Opens an SSE stream for a chat turn.
 * Sends the full conversation so the backend has context for follow-ups.
 * Accepts an optional AbortSignal — used by the Stop button in a later plan.
 */
export async function startChat(messages: ChatMessage[], signal?: AbortSignal): Promise<Response> {
  const payload = {
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  }
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!res.ok) throw await toApiError(res)
  return res
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): startChat accepts messages[] and AbortSignal"
```

### Task 7: Create `useChatStore` with message-level marker split (the bug fix)

**Files:**
- Create: `frontend/src/stores/chatStore.ts`
- Create: `frontend/src/stores/__tests__/chatStore.test.ts`

- [ ] **Step 1: Write failing test — split-marker across frames**

Create `frontend/src/stores/__tests__/chatStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chatStore'

function makeSSEResponse(frames: string[]) {
  const body = frames.map(f => `data: ${f}\r\n\r\n`).join('')
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body))
      controller.close()
    },
  })
  return { ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response
}

beforeEach(() => {
  useChatStore.setState({ messages: [], streaming: false, error: null })
  vi.restoreAllMocks()
})

describe('useChatStore.send', () => {
  it('appends user and assistant messages in order', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Hello ', 'world.'])
    ))

    await useChatStore.getState().send('How are you?')

    const { messages, streaming } = useChatStore.getState()
    expect(streaming).toBe(false)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('How are you?')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Hello world.')
  })

  it('parses citations when the marker arrives as one frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Hello world.', '__CITATIONS__:deploy-process'])
    ))

    await useChatStore.getState().send('q')

    const assistant = useChatStore.getState().messages[1]
    expect(assistant.content).toBe('Hello world.')
    expect(assistant.citations).toEqual(['deploy-process'])
  })

  it('parses citations even when the marker is split across frames', async () => {
    // This is the bug: the old per-frame includes() check would miss this split.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Answer.', '__', 'CIT', 'ATIONS', '__', ':deploy', '-process', ',ci-cd'])
    ))

    await useChatStore.getState().send('q')

    const assistant = useChatStore.getState().messages[1]
    expect(assistant.content).toBe('Answer.')
    expect(assistant.citations).toEqual(['deploy-process', 'ci-cd'])
  })

  it('sends prior turns on a follow-up send', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeSSEResponse(['First answer.']))
      .mockResolvedValueOnce(makeSSEResponse(['Second answer.']))
    vi.stubGlobal('fetch', fetchMock)

    await useChatStore.getState().send('Q1')
    await useChatStore.getState().send('Q2')

    const body2 = JSON.parse(fetchMock.mock.calls[1][1].body)
    expect(body2.messages.map((m: { role: string }) => m.role)).toEqual([
      'user', 'assistant', 'user',
    ])
    expect(body2.messages[0].content).toBe('Q1')
    expect(body2.messages[2].content).toBe('Q2')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: FAIL — store doesn't exist.

- [ ] **Step 3: Create the store**

Create `frontend/src/stores/chatStore.ts`:

```ts
import { create } from 'zustand'
import { ApiError, startChat, coerceApiError } from '../lib/api'
import type { ChatMessage, ApiErrorBody } from '../lib/types'

const CITATIONS_MARKER = '__CITATIONS__:'

interface SSEFrame {
  event: string | null
  data: string
}

function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = []
  const parts = buffer.split(/\r?\n\r?\n/)
  const rest = parts.pop() ?? ''
  for (const part of parts) {
    if (!part.trim()) continue
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith('event: ')) event = line.slice(7).trim()
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
    }
    if (dataLines.length) frames.push({ event, data: dataLines.join('\n') })
  }
  return { frames, rest }
}

function splitCitations(raw: string): { content: string; citations: string[] } {
  const idx = raw.lastIndexOf(CITATIONS_MARKER)
  if (idx < 0) return { content: raw, citations: [] }
  const content = raw.slice(0, idx).replace(/\s+$/, '')
  const citationsPart = raw.slice(idx + CITATIONS_MARKER.length)
  const citations = citationsPart
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
  return { content, citations }
}

// Module-level abort handle — used by the stop action in a later plan.
export const abortRef: { current: AbortController | null } = { current: null }

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  error: ApiError | null
  send: (content: string) => Promise<void>
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  error: null,
  clearError: () => set({ error: null }),

  send: async (content: string) => {
    if (get().streaming) return
    set({ error: null })

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'user', content, citations: [],
    }
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(), role: 'assistant', content: '', citations: [],
    }
    const history = [...get().messages, userMsg]
    set({ messages: [...history, assistantMsg], streaming: true })

    abortRef.current = new AbortController()
    let rawContent = ''
    let receivedFrame = false

    try {
      const response = await startChat(history, abortRef.current.signal)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const { frames, rest } = parseSSEFrames(buffer)
        buffer = rest

        for (const frame of frames) {
          receivedFrame = true
          if (frame.event === 'error') {
            try {
              const body = JSON.parse(frame.data) as ApiErrorBody
              set({
                error: new ApiError({
                  code: body.code, message: body.message,
                  requestId: body.request_id, status: 200,
                }),
              })
            } catch {
              set({
                error: new ApiError({
                  code: 'INTERNAL_ERROR', message: 'Stream failed.',
                  requestId: null, status: 200,
                }),
              })
            }
          } else {
            rawContent += frame.data
            const { content: visible, citations } = splitCitations(rawContent)
            set(state => {
              const last = state.messages[state.messages.length - 1]
              if (last.id !== assistantMsg.id) return state
              return {
                messages: [
                  ...state.messages.slice(0, -1),
                  { ...last, content: visible, citations },
                ],
              }
            })
          }
        }
      }

      if (!receivedFrame) {
        set({
          error: new ApiError({
            code: 'INTERNAL_ERROR',
            message: 'The assistant did not respond. Please check the server configuration.',
            requestId: null, status: 200,
          }),
        })
      }
    } catch (e: unknown) {
      if ((e as { name?: string })?.name === 'AbortError') {
        // User-initiated stop (implemented in a later plan). Silent.
      } else {
        set({ error: coerceApiError(e, 'Stream failed.') })
      }
    } finally {
      set({ streaming: false })
      abortRef.current = null
      set(state => {
        const last = state.messages[state.messages.length - 1]
        if (last?.id === assistantMsg.id && last.content === '') {
          return { messages: state.messages.slice(0, -1) }
        }
        return state
      })
    }
  },
}))
```

- [ ] **Step 4: Run the store tests**

Run: `cd frontend && pnpm test src/stores/__tests__/chatStore.test.ts`
Expected: all 4 tests PASS, including the split-marker case.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/chatStore.ts frontend/src/stores/__tests__/chatStore.test.ts
git commit -m "feat(store): useChatStore with message-level marker split (fixes SSE bug)"
```

### Task 8: Refactor `useChat` into a thin Zustand façade

**Files:**
- Modify: `frontend/src/hooks/useChat.ts`
- Modify: `frontend/src/hooks/__tests__/useChat.test.ts`

- [ ] **Step 1: Replace `useChat.ts` body**

Overwrite `frontend/src/hooks/useChat.ts` with:

```ts
import { useShallow } from 'zustand/react/shallow'
import { useChatStore } from '../stores/chatStore'

export function useChat() {
  return useChatStore(useShallow(s => ({
    messages: s.messages,
    streaming: s.streaming,
    error: s.error,
    sendMessage: s.send,
  })))
}
```

The existing `sendMessage` name is preserved so current call sites (`ChatPage`) keep working.

- [ ] **Step 2: Update `useChat.test.ts` imports**

Edit `frontend/src/hooks/__tests__/useChat.test.ts`. At the top, after imports, add:

```ts
import { useChatStore } from '../../stores/chatStore'

beforeEach(() => {
  useChatStore.setState({ messages: [], streaming: false, error: null })
})
```

The existing tests will still pass — they only use `result.current.sendMessage` and `result.current.messages`, which the façade preserves. Note: the existing `makeSSEResponse` fixture joins the marker into one chunk; that still works under the new parser.

- [ ] **Step 3: Run all frontend tests**

Run: `cd frontend && pnpm test`
Expected: all tests PASS.

- [ ] **Step 4: Smoke-test the full app**

Run: `pnpm dev` from the repo root. Open `http://localhost:5173`. Send a message, verify a reply streams. Navigate to `/wiki`, then back to `/`, and confirm the conversation history is **preserved** (bubble chain is intact).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChat.ts frontend/src/hooks/__tests__/useChat.test.ts
git commit -m "refactor(useChat): become a thin façade over useChatStore"
```

---

## Verification

- [ ] **Backend full suite:** `cd backend && .venv/bin/pytest` — all tests green.
- [ ] **Frontend full suite:** `cd frontend && pnpm test` — all tests green.
- [ ] **Frontend build:** `cd frontend && pnpm build` — succeeds.
- [ ] **Manual smoke:** Run `pnpm dev`, send two chat turns ("Hello" then "What did I just say?"). Second reply should show the agent received the prior turn (content-dependent on model, but payload shape verified by unit tests).
- [ ] **Memory across routes:** After a reply, navigate `/` → `/wiki` → `/`; prior bubbles still visible.

## Self-review checklist (complete before declaring done)

- [ ] No `{question}` references remain in the frontend or backend code paths (`grep -rn "question" backend/kb backend/tests frontend/src` — any matches are unrelated usage).
- [ ] Backend rejects empty messages, blank content, non-user last turn.
- [ ] Split-marker test passes — the previously latent bug is now covered.
- [ ] Thread preserved across route nav — manual smoke.
- [ ] `git log --oneline` shows one commit per task (8 commits on this branch).
