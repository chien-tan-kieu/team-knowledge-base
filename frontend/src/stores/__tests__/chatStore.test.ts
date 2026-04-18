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
