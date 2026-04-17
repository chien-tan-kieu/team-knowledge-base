import type { WikiPage, IngestJob, LintResult, ApiErrorBody } from './types'

export class ApiError extends Error {
  code: string
  message: string
  requestId: string | null
  status: number

  constructor(init: { code: string; message: string; requestId: string | null; status: number }) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.message = init.message
    this.requestId = init.requestId
    this.status = init.status
  }
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).code === 'string' &&
    typeof (value as Record<string, unknown>).message === 'string'
  )
}

async function toApiError(res: Response): Promise<ApiError> {
  const requestIdHeader = res.headers.get('X-Request-ID')
  try {
    const body: unknown = await res.json()
    if (isApiErrorBody(body)) {
      return new ApiError({
        code: body.code,
        message: body.message,
        requestId: body.request_id ?? requestIdHeader,
        status: res.status,
      })
    }
  } catch {
    // Fall through to synthetic error below.
  }
  return new ApiError({
    code: 'INTERNAL_ERROR',
    message: `Request failed (${res.status}).`,
    requestId: requestIdHeader,
    status: res.status,
  })
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init })
  if (!res.ok) throw await toApiError(res)
  return res.json() as Promise<T>
}

export async function getWikiPages(): Promise<string[]> {
  const data = await fetchJson<{ pages: string[] }>('/api/wiki')
  return data.pages
}

export async function getWikiPage(slug: string): Promise<WikiPage> {
  return fetchJson<WikiPage>(`/api/wiki/${slug}`)
}

export async function ingestFile(file: File): Promise<IngestJob> {
  const form = new FormData()
  form.append('file', file)
  return fetchJson<IngestJob>('/api/ingest', { method: 'POST', body: form })
}

export async function getIngestJob(jobId: string): Promise<IngestJob> {
  return fetchJson<IngestJob>(`/api/ingest/${jobId}`)
}

export async function runLint(): Promise<LintResult> {
  return fetchJson<LintResult>('/api/lint', { method: 'POST' })
}

/**
 * Opens an SSE stream for a chat question.
 * Returns the raw Response — caller handles the stream.
 */
export async function startChat(question: string): Promise<Response> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw await toApiError(res)
  return res
}

let sessionPromise: Promise<void> | null = null

export async function ensureSession(): Promise<void> {
  if (sessionPromise) return sessionPromise
  sessionPromise = (async () => {
    const res = await fetch('/api/auth/session', { credentials: 'include' })
    if (!res.ok) {
      // Reset so callers can retry after handling the error.
      const err = await toApiError(res)
      sessionPromise = null
      throw err
    }
  })()
  return sessionPromise
}

/** Clears the memoized session promise so the next ensureSession() issues a fresh bootstrap. */
export function resetSessionPromise(): void {
  sessionPromise = null
}
