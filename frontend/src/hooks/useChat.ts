import { useState, useCallback } from 'react'
import { ApiError, startChat } from '../lib/api'
import type { ChatMessage, ApiErrorBody } from '../lib/types'

const CITATIONS_MARKER = '__CITATIONS__:'

function parseToken(token: string, msg: ChatMessage): ChatMessage {
  if (token.includes(CITATIONS_MARKER)) {
    const [text, citationsPart] = token.split(CITATIONS_MARKER)
    const citations = citationsPart.split(',').map(s => s.trim()).filter(Boolean)
    return { ...msg, content: msg.content + text, citations }
  }
  return { ...msg, content: msg.content + token }
}

interface SSEFrame {
  event: string | null
  data: string
}

function parseSSEFrames(buffer: string): { frames: SSEFrame[]; rest: string } {
  const frames: SSEFrame[] = []
  // SSE spec allows \n, \r, or \r\n line terminators. sse-starlette emits \r\n by default.
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

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const sendMessage = useCallback(async (question: string) => {
    setError(null)

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question, citations: [] }
    const assistantMsg: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', citations: [] }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    let receivedFrame = false
    try {
      const response = await startChat(question)
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
              setError(new ApiError({
                code: body.code,
                message: body.message,
                requestId: body.request_id,
                status: 200, // stream succeeded at HTTP level; error came mid-stream
              }))
            } catch {
              setError(new ApiError({
                code: 'INTERNAL_ERROR',
                message: 'Stream failed.',
                requestId: null,
                status: 200,
              }))
            }
          } else {
            const token = frame.data
            setMessages(prev => {
              const last = prev[prev.length - 1]
              if (last.id !== assistantMsg.id) return prev
              return [...prev.slice(0, -1), parseToken(token, last)]
            })
          }
        }
      }

      if (!receivedFrame) {
        setError(new ApiError({
          code: 'INTERNAL_ERROR',
          message: 'The assistant did not respond. Please check the server configuration.',
          requestId: null,
          status: 200,
        }))
      }
    } catch (e: unknown) {
      if (e instanceof ApiError) {
        setError(e)
      } else {
        setError(new ApiError({ code: 'INTERNAL_ERROR', message: 'Stream failed.', requestId: null, status: 0 }))
      }
    } finally {
      setStreaming(false)
      // Backstop: drop the empty assistant placeholder on every exit path.
      setMessages(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === assistantMsg.id && last.content === '') return prev.slice(0, -1)
        return prev
      })
    }
  }, [])

  return { messages, streaming, sendMessage, error }
}
