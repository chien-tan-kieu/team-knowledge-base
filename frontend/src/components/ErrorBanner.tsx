import type { ApiError } from '../lib/api'

interface Props {
  error: ApiError | null
  onRetry?: () => void
}

export function ErrorBanner({ error, onRetry }: Props) {
  if (!error) return null
  return (
    <div
      role="alert"
      className="rounded-xl px-4 py-3 font-sans text-sm flex items-start gap-3 bg-sand text-fg"
      style={{ boxShadow: 'var(--shadow-ring)' }}
    >
      <span
        aria-hidden
        className="flex-shrink-0 w-5 h-5 grid place-items-center rounded-full mt-0.5"
        style={{
          background: 'rgba(181,51,51,0.12)',
          color: 'var(--color-error-crimson)',
        }}
      >
        <svg
          className="w-3 h-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" d="M12 8v5M12 17h.01" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-fg">{error.message}</p>
        {error.requestId && (
          <p className="text-xs text-fg-dim mt-0.5 font-mono">
            Ref {error.requestId}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-1 px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg underline underline-offset-[3px]"
        >
          Retry
        </button>
      )}
    </div>
  )
}
