import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, ingestFile, getIngestJob } from '../lib/api'
import type { IngestJob } from '../lib/types'

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e
  return new ApiError({ code: 'INTERNAL_ERROR', message: 'Upload failed.', requestId: null, status: 0 })
}

export function useIngest() {
  const [job, setJob] = useState<IngestJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    setError(null)
    setJob(null)
    stopPolling()
    try {
      const newJob = await ingestFile(file)
      setJob(newJob)

      pollRef.current = setInterval(async () => {
        try {
          const updated = await getIngestJob(newJob.job_id)
          setJob(updated)
          if (updated.status === 'done') {
            stopPolling()
          }
        } catch (e: unknown) {
          setError(toApiError(e))
          stopPolling()
        }
      }, 1500)
    } catch (e: unknown) {
      setError(toApiError(e))
    } finally {
      setUploading(false)
    }
  }, [stopPolling])

  useEffect(() => stopPolling, [stopPolling])

  return { job, uploading, upload, error }
}
