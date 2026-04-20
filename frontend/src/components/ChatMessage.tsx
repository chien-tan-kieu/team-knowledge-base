import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { ChatMessage as ChatMessageType, Citation } from '../lib/types'
import { MessageEditor } from './MessageEditor'

interface Props {
  message: ChatMessageType
  editable?: boolean
  onEditSave?: (text: string) => void
}

function slugToTitle(slug: string) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function CitationChip({ citation, index }: { citation: Citation; index: number }) {
  const title = slugToTitle(citation.slug)
  const lineRange = citation.start === citation.end
    ? `line ${citation.start}`
    : `lines ${citation.start}–${citation.end}`

  return (
    <span className="relative inline-block align-super group">
      <Link
        to={`/wiki/${citation.slug}?lines=${citation.start}-${citation.end}`}
        aria-label={`Source ${index}: ${citation.slug} (${lineRange})`}
        className="inline-block font-sans text-[10.5px] font-medium leading-none px-[5px] py-[1px] rounded-[4px] transition-all duration-150 tabular-nums no-underline"
        style={{
          background: 'rgba(201,100,66,0.12)',
          color: 'var(--color-accent)',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = 'var(--color-accent)'
          e.currentTarget.style.color = 'var(--color-fg-onaccent)'
          e.currentTarget.style.transform = 'translateY(-1px)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'rgba(201,100,66,0.12)'
          e.currentTarget.style.color = 'var(--color-accent)'
          e.currentTarget.style.transform = 'translateY(0)'
        }}
      >
        {index}
      </Link>
      <span
        role="tooltip"
        className="pointer-events-none group-hover:pointer-events-auto opacity-0 group-hover:opacity-100 hidden md:block absolute top-[-8px] left-[calc(100%+18px)] w-[280px] bg-elevated rounded-xl px-4 py-3 text-left transition-[opacity,transform] duration-200 ease-out translate-x-[-6px] group-hover:translate-x-0 z-20 font-sans text-[13px] leading-relaxed normal-case tracking-normal"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <span
          aria-hidden
          className="absolute left-[-18px] top-3.5 w-[18px] border-t border-dashed"
          style={{ borderColor: 'var(--color-line-strong)' }}
        />
        <span className="inline-flex items-center gap-1.5 mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-accent">
          <span
            className="inline-block w-2 h-px"
            style={{ background: 'var(--color-accent)' }}
          />
          Source {index}
        </span>
        <span
          className="block font-serif text-[15px] font-medium leading-tight mb-1.5 text-fg"
          style={{ fontVariationSettings: '"opsz" 14' }}
        >
          {title}
        </span>
        <span className="block text-[12px] text-fg-muted font-sans">
          {lineRange}. Tap to open and jump.
        </span>
      </span>
    </span>
  )
}

function SourceRow({ citation, index }: { citation: Citation; index: number }) {
  const title = slugToTitle(citation.slug)
  const lineRange = citation.start === citation.end
    ? `line ${citation.start}`
    : `lines ${citation.start}–${citation.end}`

  return (
    <Link
      to={`/wiki/${citation.slug}?lines=${citation.start}-${citation.end}`}
      className="grid grid-cols-[22px_1fr_auto] items-center gap-3 px-3 py-2 rounded-[10px] bg-surface transition-[transform,box-shadow] duration-150 ease-out no-underline hover:translate-x-0.5"
      style={{ boxShadow: 'var(--shadow-ring)' }}
    >
      <span
        className="w-[22px] h-[22px] grid place-items-center font-sans text-[11px] font-medium rounded tabular-nums"
        style={{
          color: 'var(--color-accent)',
          background: 'rgba(201,100,66,0.1)',
        }}
      >
        {index}
      </span>
      <span className="min-w-0 overflow-hidden">
        <span className="block font-mono text-[11.5px] text-fg-dim truncate">
          {citation.slug}
        </span>
        <span
          className="block font-serif text-[14px] font-medium text-fg truncate"
          style={{ fontVariationSettings: '"opsz" 14' }}
        >
          {title}
        </span>
        <span className="block text-xs text-fg-dim mt-0.5">
          {lineRange}
        </span>
      </span>
      <span className="text-fg-dim text-[13px]" aria-hidden>→</span>
    </Link>
  )
}

export function ChatMessage({ message, editable, onEditSave }: Props) {
  const isUser = message.role === 'user'
  const isStreamingEmpty = !isUser && message.content === ''
  const [editing, setEditing] = useState(false)
  const canEdit = isUser && !!editable && !!onEditSave
  // Derive effective editing from canEdit so revoked editability (e.g. a newer
  // user message arrives) closes the editor without an extra effect/render.
  const isEditing = editing && canEdit

  if (isUser) {
    const interactive = canEdit && !isEditing
    return (
      <div className="flex flex-col items-end gap-2.5 animate-[fadeIn_0.4s_ease-out]">
        <div className="inline-flex flex-row-reverse items-center gap-2.5 text-[12px] text-fg-dim">
          <span
            className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-medium font-serif text-fg-onaccent"
            style={{
              background: 'var(--color-charcoal-warm)',
              boxShadow:
                '0 0 0 2px var(--color-canvas), 0 0 0 3px var(--color-line-strong)',
            }}
            aria-hidden
          >
            U
          </span>
          <span className="font-medium text-[12.5px] text-fg-muted">You</span>
        </div>
        {isEditing && onEditSave ? (
          <div
            className="max-w-[80%] px-4 py-[11px] rounded-[14px] rounded-br-[4px] bg-sand text-fg text-[14.5px] leading-relaxed"
            style={{ boxShadow: 'var(--shadow-ring)' }}
          >
            <MessageEditor
              initial={message.content}
              onSave={text => { onEditSave(text); setEditing(false) }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <div
            onClick={() => { if (interactive) setEditing(true) }}
            onKeyDown={e => {
              if (!interactive) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setEditing(true)
              }
            }}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            className={`max-w-[80%] px-4 py-[11px] rounded-[14px] rounded-br-[4px] bg-sand text-fg text-[14.5px] leading-relaxed whitespace-pre-wrap break-words ${
              interactive ? 'cursor-pointer hover:opacity-90' : ''
            }`}
            style={{ boxShadow: 'var(--shadow-ring)' }}
          >
            {message.content}
          </div>
        )}
      </div>
    )
  }

  // Assistant
  return (
    <article className="flex flex-col gap-2.5 animate-[fadeIn_0.4s_ease-out]">
      <header className="inline-flex items-center gap-2.5 text-[12px] text-fg-dim">
        <span
          className="w-6 h-6 rounded-full grid place-items-center text-[11px] font-medium font-serif bg-accent text-fg-onaccent"
          style={{
            boxShadow:
              '0 0 0 2px var(--color-canvas), 0 0 0 3px var(--color-line-strong)',
          }}
          aria-hidden
        >
          K
        </span>
        <span className="font-medium text-[12.5px] text-fg-muted">Knowledge Base</span>
        <span className="text-fg-dim" aria-hidden>·</span>
        <span className="font-mono text-[11px] text-fg-dim">wiki</span>
      </header>

      <div className="prose-assistant">
        {isStreamingEmpty ? (
          <span
            className="inline-flex items-center gap-1 py-0.5"
            aria-label="Assistant is typing"
          >
            <span
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: 'var(--color-fg-dim)', animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: 'var(--color-fg-dim)', animationDelay: '150ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: 'var(--color-fg-dim)', animationDelay: '300ms' }}
            />
          </span>
        ) : (
          <>
            <p className="whitespace-pre-wrap break-words">
              {message.content}
              {message.citations.length > 0 && (
                <span className="ml-1">
                  {message.citations.map((citation, i) => (
                    <CitationChip key={`${citation.slug}:${citation.start}-${citation.end}`} citation={citation} index={i + 1} />
                  ))}
                </span>
              )}
            </p>
          </>
        )}
      </div>

      {message.citations.length > 0 && (
        <footer
          className="mt-2 pt-3 border-t border-dashed flex flex-col gap-2.5"
          style={{ borderColor: 'var(--color-line-strong)' }}
        >
          <div className="flex items-center gap-2.5 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-dim">
            <span>Sources</span>
            <span className="text-accent">{message.citations.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {message.citations.map((citation, i) => (
              <SourceRow key={`${citation.slug}:${citation.start}-${citation.end}`} citation={citation} index={i + 1} />
            ))}
          </div>
        </footer>
      )}
    </article>
  )
}
