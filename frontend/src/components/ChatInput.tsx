import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  onSend: (message: string) => void
  onStop?: () => void
  streaming?: boolean
  disabled?: boolean
}

export function ChatInput({ onSend, onStop, streaming = false, disabled = false }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleSend() {
    const trimmed = value.trim()
    if (!trimmed || disabled || streaming) return
    onSend(trimmed)
    setValue('')
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const showStop = streaming && !!onStop

  return (
    <div className="flex gap-2 items-end bg-ivory border border-border-warm rounded-xl px-3 sm:px-4 py-2 shadow-whisper">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask anything about your team's knowledge…"
        rows={1}
        disabled={disabled || streaming}
        autoComplete="off"
        className="flex-1 min-w-0 resize-none max-h-48 overflow-y-auto bg-transparent text-base md:text-sm text-near-black placeholder:text-warm-silver outline-none font-sans leading-relaxed"
      />
      {showStop ? (
        <button
          onClick={onStop}
          aria-label="Stop"
          className="bg-near-black text-ivory text-sm font-medium font-sans px-4 min-h-11 md:min-h-0 md:py-1.5 rounded-lg hover:opacity-90 transition-opacity"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          aria-label="Send"
          className="bg-terracotta text-ivory text-sm font-medium font-sans px-4 min-h-11 md:min-h-0 md:py-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Send
        </button>
      )}
    </div>
  )
}
