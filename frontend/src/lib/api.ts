import type { WikiPage, IngestJob, LintResult } from './types'

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = init !== undefined ? await fetch(url, init) : await fetch(url)
  if (!res.ok) throw new Error(`API error ${res.status}: ${url}`)
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
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) throw new Error(`Chat API error ${res.status}`)
  return res
}
