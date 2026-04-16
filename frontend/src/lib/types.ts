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

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  citations: string[]  // wiki page slugs
}

export interface LintResult {
  orphans: string[]
  contradictions: string[]
}
