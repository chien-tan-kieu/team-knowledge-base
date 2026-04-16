import type { ChatMessage as ChatMessageType } from '../lib/types'

interface Props {
  message: ChatMessageType
}

export function ChatMessage({ message }: Props) {
  const isUser = message.role === 'user'

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
        className={`max-w-prose rounded-xl px-4 py-3 text-sm leading-relaxed font-sans shadow-whisper ${
          isUser
            ? 'bg-near-black text-ivory rounded-tr-sm'
            : 'bg-ivory border border-border-cream text-near-black rounded-tl-sm'
        }`}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>

        {message.citations.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border-cream flex flex-wrap gap-1">
            {message.citations.map(slug => (
              <span
                key={slug}
                className="inline-block bg-parchment border border-border-warm rounded text-stone-gray text-xs px-1.5 py-0.5"
              >
                {slug}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
