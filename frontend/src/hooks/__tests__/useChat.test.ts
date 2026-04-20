import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChat } from '../useChat'
import { ApiError } from '../../lib/api'
import { useChatStore } from '../../stores/chatStore'

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

beforeEach(() => {
  useChatStore.setState({ messages: [], streaming: false, error: null })
  vi.restoreAllMocks()
})

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

function makeErrorEventResponse(tokens: string[], errorBody: { code: string; message: string; request_id: string | null }) {
  // SSE mixed frames: `data: token\n\n` ... `event: error\ndata: {json}\n\n`
  const body =
    tokens.map(t => `data: ${t}\n\n`).join('') +
    `event: error\ndata: ${JSON.stringify(errorBody)}\n\n`
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body))
      controller.close()
    },
  })
  return { ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response
}

describe('useChat error surfaces', () => {
  it('exposes error: ApiError when the SSE stream emits an error event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeErrorEventResponse(['Hello '], {
        code: 'UPSTREAM_LLM_ERROR',
        message: 'The language model is currently unavailable.',
        request_id: '01H',
      }),
    ))

    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage('why?')
    })

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.code).toBe('UPSTREAM_LLM_ERROR')
    // Prior tokens preserved on the assistant message.
    expect(result.current.messages[1].content).toContain('Hello')
  })

  it('removes empty assistant bubble when SSE error arrives before any tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeErrorEventResponse([], {
        code: 'UPSTREAM_LLM_ERROR',
        message: 'The language model is currently unavailable.',
        request_id: '01H',
      }),
    ))

    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage('hello?')
    })

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toBe('The language model is currently unavailable.')
    // Only the user message should remain — no empty assistant bubble.
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].role).toBe('user')
  })

  it('surfaces error and removes empty bubble when stream closes with zero frames', async () => {
    // Simulates the LLM-not-configured case: backend returns HTTP 200 and
    // closes the stream without yielding any data or error events.
    const emptyStream = new ReadableStream({
      start(controller) {
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: true, body: emptyStream.pipeThrough(new TransformStream()) } as unknown as Response,
    ))

    const { result } = renderHook(() => useChat())
    await act(async () => {
      await result.current.sendMessage('are you there?')
    })

    expect(result.current.error).toBeInstanceOf(ApiError)
    expect(result.current.error?.message).toContain('did not respond')
    expect(result.current.messages).toHaveLength(1)
    expect(result.current.messages[0].role).toBe('user')
    expect(result.current.streaming).toBe(false)
  })
})
