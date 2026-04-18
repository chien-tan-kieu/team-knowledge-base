import { create } from 'zustand'
import { ApiError, startChat, coerceApiError } from '../lib/api'
import type { ChatMessage, ApiErrorBody, Citation } from '../lib/types'

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

// Module-level abort handle — used by the stop action in a later plan.
export const abortRef: { current: AbortController | null } = { current: null }

interface ChatState {
  messages: ChatMessage[]
  streaming: boolean
  error: ApiError | null
  send: (content: string) => Promise<void>
  stop: () => void
  editLast: (newContent: string) => Promise<void>
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  streaming: false,
  error: null,
  clearError: () => set({ error: null }),
  stop: () => {
    abortRef.current?.abort()
  },

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
