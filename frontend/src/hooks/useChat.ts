import { useState, useCallback } from 'react'
import { startChat } from '../lib/api'
import type { ChatMessage } from '../lib/types'

const CITATIONS_MARKER = '__CITATIONS__:'

function parseToken(token: string, msg: ChatMessage): ChatMessage {
  if (token.includes(CITATIONS_MARKER)) {
    const [text, citationsPart] = token.split(CITATIONS_MARKER)
    const citations = citationsPart.split(',').map(s => s.trim()).filter(Boolean)
    return { ...msg, content: msg.content + text, citations }
  }
  return { ...msg, content: msg.content + token }
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)

  const sendMessage = useCallback(async (question: string) => {
    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      citations: [],
    }

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      citations: [],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setStreaming(true)

    try {
      const response = await startChat(question)
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true })

        // SSE lines: "data: <token>\n\n"
        const lines = text.split('\n')
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const token = line.slice(6)
          setMessages(prev => {
            const last = prev[prev.length - 1]
            if (last.id !== assistantMsg.id) return prev
            return [...prev.slice(0, -1), parseToken(token, last)]
          })
        }
      }
    } catch {
      // Remove the empty assistant placeholder on error
      setMessages(prev => prev.filter(m => m.id !== assistantMsg.id))
    } finally {
      setStreaming(false)
    }
  }, [])

  return { messages, streaming, sendMessage }
}
