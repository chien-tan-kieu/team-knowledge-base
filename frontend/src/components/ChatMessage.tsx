import { useEffect, useState } from 'react'
import type { ChatMessage as ChatMessageType } from '../lib/types'
import { ReferenceChip } from './ReferenceChip'
import { MessageEditor } from './MessageEditor'

interface Props {
  message: ChatMessageType
  editable?: boolean
  onEditSave?: (text: string) => void
}

export function ChatMessage({ message, editable, onEditSave }: Props) {
  const isUser = message.role === 'user'
  const [editing, setEditing] = useState(false)
  const canEdit = isUser && editable && !!onEditSave

  // If editability is revoked (e.g. a newer user message arrives), close the
  // editor so its Save cannot clobber a different message via editLast().
  useEffect(() => { if (!canEdit && editing) setEditing(false) }, [canEdit, editing])

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-medium font-sans ${
          isUser
            ? 'bg-warm-sand text-charcoal-warm'
            : 'bg-terracotta text-ivory'
        }`}
      >
        {isUser ? 'U' : 'K'}
      </div>

      {/* Bubble */}
      <div
        onClick={() => { if (canEdit && !editing) setEditing(true) }}
        onKeyDown={(e) => {
          if (!canEdit || editing) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setEditing(true)
          }
        }}
        role={canEdit && !editing ? 'button' : undefined}
        tabIndex={canEdit && !editing ? 0 : undefined}
        className={`min-w-0 max-w-[calc(100%-2.5rem)] sm:max-w-prose rounded-xl px-3 py-2 sm:px-4 sm:py-3 text-sm leading-relaxed font-sans shadow-whisper ${
          isUser
            ? 'bg-near-black text-ivory rounded-tr-sm'
            : 'bg-ivory border border-border-cream text-near-black rounded-tl-sm'
        } ${canEdit && !editing ? 'cursor-pointer hover:opacity-90' : ''}`}
      >
        {editing && onEditSave ? (
          <MessageEditor
            initial={message.content}
            onSave={text => { onEditSave(text); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        ) : !isUser && message.content === '' ? (
          <div className="flex items-center gap-1 py-1" aria-label="Assistant is typing">
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-stone-gray animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        )}

        {!editing && message.citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-cream">
            <div className="text-xs text-stone-gray font-sans mb-1">References</div>
            <div className="flex flex-wrap gap-1">
              {message.citations.map((c, i) => (
                <ReferenceChip key={`${c.slug}:${c.start}-${c.end}:${i}`} citation={c} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
