import { useState, useCallback, useRef, useEffect } from 'react'
import { ingestFile, getIngestJob } from '../lib/api'
import type { IngestJob } from '../lib/types'

export function useIngest() {
  const [job, setJob] = useState<IngestJob | null>(null)
  const [uploading, setUploading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const upload = useCallback(async (file: File) => {
    setUploading(true)
    stopPolling()
    try {
      const newJob = await ingestFile(file)
      setJob(newJob)

      // Poll until done or failed
      pollRef.current = setInterval(async () => {
        const updated = await getIngestJob(newJob.job_id)
        setJob(updated)
        if (updated.status === 'done' || updated.status === 'failed') {
          stopPolling()
        }
      }, 1500)
    } finally {
      setUploading(false)
    }
  }, [stopPolling])

  useEffect(() => stopPolling, [stopPolling])

  return { job, uploading, upload }
}
