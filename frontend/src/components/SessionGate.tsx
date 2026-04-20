import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ensureSession, ApiError, resetSessionPromise } from '../lib/api'

import { ErrorBanner } from './ErrorBanner'

interface Props {
  children: ReactNode
}

type State =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'error'; error: ApiError }

export function SessionGate({ children }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' })

  const bootstrap = useCallback(() => {
    setState({ status: 'loading' })
    ensureSession()
      .then(() => setState({ status: 'ready' }))
      .catch((err: unknown) => {
        const apiErr =
          err instanceof ApiError
            ? err
            : new ApiError({ code: 'INTERNAL_ERROR', message: 'Could not start session.', requestId: null, status: 0 })
        setState({ status: 'error', error: apiErr })
      })
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap() kicks off async work; setState fires after await, not synchronously.
    bootstrap()
  }, [bootstrap])

  if (state.status === 'loading') {
    return (
      <div className="h-dvh grid place-items-center bg-canvas">
        <div className="flex flex-col items-center gap-3 animate-pulse">
          <span
            aria-hidden
            className="w-10 h-10 rounded-full grid place-items-center text-accent"
            style={{ background: 'rgba(201,100,66,0.1)' }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 4h9l3 3v13H6z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 4v3h3" />
            </svg>
          </span>
          <p
            className="font-serif text-sm text-fg-muted"
            style={{ fontVariationSettings: '"opsz" 14' }}
          >
            Signing in…
          </p>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="h-dvh grid place-items-center bg-canvas px-4">
        <div className="w-full max-w-md">
          <ErrorBanner
            error={state.error}
            onRetry={() => {
              resetSessionPromise()
              bootstrap()
            }}
          />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
