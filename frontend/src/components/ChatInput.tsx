import { useState, type KeyboardEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  disabled?: boolean
}

export function ChatInput({ onSend, disabled = false }: Props) {
  const [value, setValue] = useState('')

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex gap-2 items-end bg-ivory border border-border-warm rounded-xl px-3 sm:px-4 py-2 shadow-whisper">
      <textarea
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your team's knowledge…"
        rows={1}
        disabled={disabled}
        autoComplete="off"
        className="flex-1 min-w-0 resize-none bg-transparent text-base md:text-sm text-near-black placeholder:text-warm-silver outline-none font-sans leading-relaxed"
      />
      <button
        onClick={handleSend}
        disabled={disabled || !value.trim()}
        className="bg-terracotta text-ivory text-sm font-medium font-sans px-4 min-h-11 md:min-h-0 md:py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        Send
      </button>
    </div>
  )
}
