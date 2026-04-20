import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../chatStore'
import { ApiError } from '../../lib/api'

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

  it('parses a single ranged citation when the marker arrives as one frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Hello world.', '__CITATIONS__:deploy-process:1-5'])
    ))

    await useChatStore.getState().send('q')

    const assistant = useChatStore.getState().messages[1]
    expect(assistant.content).toBe('Hello world.')
    expect(assistant.citations).toEqual([{ slug: 'deploy-process', start: 1, end: 5 }])
  })

  it('parses ranged citations even when the marker is split across frames', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      makeSSEResponse(['Answer.', '__', 'CIT', 'ATIONS', '__', ':deploy', '-process:15-22', ',ci-cd:30'])
    ))

    await useChatStore.getState().send('q')

    const assistant = useChatStore.getState().messages[1]
    expect(assistant.content).toBe('Answer.')
    expect(assistant.citations).toEqual([
      { slug: 'deploy-process', start: 15, end: 22 },
      { slug: 'ci-cd', start: 30, end: 30 },
    ])
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

describe('useChatStore.stop', () => {
  it('aborts the in-flight stream and preserves partial text', async () => {
    // Infinite stream that never completes on its own.
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(new TextEncoder().encode('data: Partial\r\n\r\n'))
        // Don't close — simulates an ongoing answer.
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal
      // Simulate real fetch: aborting errors the response body stream.
      signal?.addEventListener('abort', () => {
        streamController?.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
      return Promise.resolve({ ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response)
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
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller
        controller.enqueue(new TextEncoder().encode('data: Partial\r\n\r\n'))
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal
      signal?.addEventListener('abort', () => {
        streamController?.error(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      })
      return Promise.resolve({ ok: true, body: stream.pipeThrough(new TransformStream()) } as unknown as Response)
    }))

    const sendPromise = useChatStore.getState().send('hi')
    await new Promise(r => setTimeout(r, 10))
    useChatStore.getState().newChat()
    await sendPromise
    expect(useChatStore.getState().messages).toEqual([])
  })
})
