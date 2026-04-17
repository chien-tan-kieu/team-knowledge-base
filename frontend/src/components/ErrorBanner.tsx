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
      className="bg-warm-sand border border-border-cream text-near-black rounded-md px-4 py-3 font-sans text-sm flex items-start gap-3"
    >
      <div className="flex-1">
        <p className="font-medium">{error.message}</p>
        {error.requestId && (
          <p className="text-xs text-stone-gray mt-1">Reference: {error.requestId}</p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="-my-1 px-2 py-1 text-xs font-medium text-olive-gray hover:text-near-black underline"
        >
          Retry
        </button>
      )}
    </div>
  )
}
