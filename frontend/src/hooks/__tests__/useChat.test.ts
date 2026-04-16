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
