import { useRef, useEffect } from 'react'
import { ChatMessage } from '../components/ChatMessage'
import { ChatInput } from '../components/ChatInput'
import { ErrorBanner } from '../components/ErrorBanner'
import { PreviewPanel } from '../components/PreviewPanel'
import { useChat } from '../hooks/useChat'

export function ChatPage() {
  const { messages, streaming, sendMessage, error } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="relative flex flex-col h-full">
      <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-border-cream">
        <h1 className="font-serif text-lg sm:text-xl font-medium text-near-black leading-tight">
          Ask the knowledge base
        </h1>
        <p className="text-xs text-stone-gray font-sans mt-0.5">Powered by LLM Wiki</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 flex flex-col gap-5">
        {messages.length === 0 && !error && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-stone-gray font-sans text-sm text-center max-w-xs">
              Ask me anything about your team's documentation, processes, or architecture.
            </p>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {streaming && (
          <div className="text-stone-gray text-xs font-sans animate-pulse">Thinking…</div>
        )}
        {error && <ErrorBanner error={error} />}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-border-cream bg-ivory pb-safe">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
      <PreviewPanel />
    </div>
  )
}
