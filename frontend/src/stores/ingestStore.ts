import { create } from 'zustand'
import { ApiError, coerceApiError, getIngestJob, ingestFile } from '../lib/api'
import type { IngestJob } from '../lib/types'
import { useNotificationsStore } from './notificationsStore'

interface IngestState {
  job: IngestJob | null
  uploading: boolean
  error: ApiError | null
  upload: (file: File) => Promise<void>
}

// Module-local poll handle — not part of store state.
const pollRef: { current: ReturnType<typeof setInterval> | null } = { current: null }

function stopPolling(): void {
  if (pollRef.current) {
    clearInterval(pollRef.current)
    pollRef.current = null
  }
}

function notifyDone(job: IngestJob): void {
  useNotificationsStore.getState().push({
    kind: 'ingest-success',
    title: `Compiled ${job.filename}`,
    filename: job.filename,
    jobId: job.job_id,
  })
}

function notifyFailed(job: IngestJob, message: string | null): void {
  useNotificationsStore.getState().push({
    kind: 'ingest-failure',
    title: `Failed to compile ${job.filename}`,
    detail: message ?? undefined,
    filename: job.filename,
    jobId: job.job_id,
  })
}

export const useIngestStore = create<IngestState>((set, get) => ({
  job: null,
  uploading: false,
  error: null,
  upload: async (file: File) => {
    stopPolling()
    set({ uploading: true, error: null, job: null })
    try {
      const newJob = await ingestFile(file)
      set({ job: newJob })

      pollRef.current = setInterval(async () => {
        try {
          const updated = await getIngestJob(newJob.job_id)
          const prev = get().job
          if (prev?.job_id !== newJob.job_id) return
          if (prev.status === updated.status) return
          set({ job: updated })
          if (updated.status === 'done') {
            stopPolling()
            notifyDone(updated)
          } else if (updated.status === 'failed') {
            stopPolling()
            notifyFailed(updated, updated.error)
          }
        } catch (e: unknown) {
          const apiErr = coerceApiError(e, 'Polling failed.')
          const prev = get().job
          if (prev?.job_id !== newJob.job_id) return
          const failed: IngestJob = { ...prev, status: 'failed', error: apiErr.message }
          set({ job: failed, error: apiErr })
          stopPolling()
          notifyFailed(failed, apiErr.message)
        }
      }, 1500)
    } catch (e: unknown) {
      set({ error: coerceApiError(e, 'Upload failed.') })
    } finally {
      set({ uploading: false })
    }
  },
}))
