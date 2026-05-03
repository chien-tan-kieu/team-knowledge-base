import { useState, useCallback } from 'react'
import { syncVault, getIngestJob } from '../lib/api'
import type { SyncJob } from '../lib/types'

const POLL_INTERVAL_MS = 1500

export function useVaultSync() {
  const [syncJobs, setSyncJobs] = useState<SyncJob[]>([])
  const [syncing, setSyncing] = useState(false)

  const triggerSync = useCallback(async () => {
    setSyncing(true)
    try {
      const { jobs } = await syncVault()
      if (jobs.length === 0) {
        return
      }
      setSyncJobs(jobs.map(j => ({ ...j, status: 'pending' as const })))

      const polls = jobs.map(({ job_id }) =>
        new Promise<void>(resolve => {
          const id = setInterval(async () => {
            try {
              const updated = await getIngestJob(job_id)
              setSyncJobs(prev =>
                prev.map(j =>
                  j.job_id === job_id
                    ? { ...j, status: updated.status, error: updated.error ?? undefined }
                    : j
                )
              )
              if (updated.status === 'done' || updated.status === 'failed') {
                clearInterval(id)
                resolve()
              }
            } catch {
              clearInterval(id)
              setSyncJobs(prev =>
                prev.map(j => j.job_id === job_id ? { ...j, status: 'failed' } : j)
              )
              resolve()
            }
          }, POLL_INTERVAL_MS)
        })
      )

      await Promise.all(polls)
    } finally {
      setSyncing(false)
    }
  }, [])

  return { triggerSync, syncJobs, syncing }
}
