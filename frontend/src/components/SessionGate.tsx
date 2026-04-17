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
    bootstrap()
  }, [bootstrap])

  if (state.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-sm text-stone-gray font-sans animate-pulse">Signing in…</p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="p-6 max-w-lg mx-auto mt-12">
        <ErrorBanner
          error={state.error}
          onRetry={() => {
            resetSessionPromise()
            bootstrap()
          }}
        />
      </div>
    )
  }

  return <>{children}</>
}
