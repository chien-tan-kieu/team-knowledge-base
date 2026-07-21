import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSearchResults, coerceApiError, ApiError } from '../lib/api'
import { useChatStore } from '../stores/chatStore'
import type { SearchResult } from '../lib/types'
import { ErrorBanner } from './ErrorBanner'

interface Props {
  open: boolean
  onClose: () => void
}

const DEBOUNCE_MS = 200

export function SearchOverlay({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const trimmed = query.trim()
  // Row model: index 0 is the Ask row (present only for a non-empty query),
  // followed by one row per page result.
  const rowCount = (trimmed ? 1 : 0) + results.length

  // Focus the input and reset transient state whenever the overlay opens.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting transient state on close is the canonical pattern.
      setQuery('')
      setResults([])
      setError(null)
      setHighlight(0)
    }
  }, [open])

  // Debounced, abortable search-as-you-type.
  useEffect(() => {
    if (!open) return
    if (!trimmed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting search state on empty query is the canonical pattern.
      setResults([])
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    const timer = setTimeout(() => {
      getSearchResults(trimmed, controller.signal)
        .then(res => {
          setResults(res)
          setError(null)
          setHighlight(0)
        })
        .catch((e: unknown) => {
          if ((e as { name?: string })?.name === 'AbortError') return
          setError(coerceApiError(e, 'Search failed.'))
          setResults([])
        })
        .finally(() => setLoading(false))
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, trimmed])

  function activate(index: number) {
    if (trimmed && index === 0) {
      navigate('/')
      useChatStore.getState().send(trimmed)
      onClose()
      return
    }
    const result = results[trimmed ? index - 1 : index]
    if (result) {
      navigate(`/wiki/${result.slug}`)
      onClose()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (rowCount > 0) activate(highlight)
    }
  }

  const askRowIndex = 0
  const rows = useMemo(() => results.map((r, i) => ({ result: r, index: (trimmed ? 1 : 0) + i })), [results, trimmed])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Search"
    >
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 bg-near-black/30"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-[560px] rounded-xl bg-canvas overflow-hidden"
        style={{ boxShadow: 'var(--shadow-ring)' }}
        onKeyDown={handleKeyDown}
      >
        <div className="grid grid-cols-[16px_1fr] items-center gap-2.5 px-4 py-3 border-b border-line">
          <svg className="w-4 h-4 text-fg-dim" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path strokeLinecap="round" d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            role="searchbox"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, ask anything…"
            className="w-full bg-transparent outline-none text-[14px] text-fg placeholder:text-fg-dim font-sans"
          />
        </div>

        <div className="max-h-[52vh] overflow-y-auto py-1" role="listbox" aria-label="Search results">
          {trimmed && (
            <button
              type="button"
              role="option"
              aria-selected={highlight === askRowIndex}
              onClick={() => activate(askRowIndex)}
              onMouseEnter={() => setHighlight(askRowIndex)}
              className={[
                'w-full text-left px-4 py-2.5 flex items-center gap-2 font-sans text-[13.5px]',
                highlight === askRowIndex ? 'bg-sand text-fg' : 'text-fg-muted hover:bg-line',
              ].join(' ')}
            >
              <span className="text-accent" aria-hidden>✱</span>
              <span className="truncate">Ask: <span className="text-fg">{trimmed}</span></span>
            </button>
          )}

          {rows.map(({ result, index }) => (
            <button
              key={result.slug}
              type="button"
              role="option"
              aria-selected={highlight === index}
              onClick={() => activate(index)}
              onMouseEnter={() => setHighlight(index)}
              className={[
                'w-full text-left px-4 py-2.5 flex flex-col gap-0.5',
                highlight === index ? 'bg-sand' : 'hover:bg-line',
              ].join(' ')}
            >
              <span className="flex items-baseline gap-2">
                <span className="font-sans text-[13.5px] font-medium text-fg truncate">{result.title}</span>
                <span className="font-mono text-[11px] text-fg-dim truncate">{result.slug}</span>
              </span>
              <span className="font-sans text-[12px] text-fg-dim line-clamp-1">{result.snippet}</span>
            </button>
          ))}

          {error && (
            <div className="px-4 py-3">
              <ErrorBanner error={error} />
            </div>
          )}
          {!error && trimmed && !loading && results.length === 0 && (
            <p className="px-4 py-3 text-[12.5px] text-fg-dim font-sans">
              No pages match — press Enter to ask instead.
            </p>
          )}
          {!trimmed && (
            <p className="px-4 py-3 text-[12.5px] text-fg-dim font-sans">
              Type to search your wiki, or ask a question.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
