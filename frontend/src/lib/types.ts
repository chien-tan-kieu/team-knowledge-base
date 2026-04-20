export interface WikiPage {
  slug: string
  content: string
}

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface IngestJob {
  job_id: string
  filename: string
  status: JobStatus
  error: string | null
}

export interface Citation {
  slug: string
  start: number
  end: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: Citation[]
}

export interface LintResult {
  orphans: string[]
  contradictions: string[]
}

export interface ApiErrorBody {
  code: string
  message: string
  request_id: string | null
}
