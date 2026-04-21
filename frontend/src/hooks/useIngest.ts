import { useIngestStore } from '../stores/ingestStore'

export function useIngest() {
  const job = useIngestStore(s => s.job)
  const uploading = useIngestStore(s => s.uploading)
  const error = useIngestStore(s => s.error)
  const upload = useIngestStore(s => s.upload)
  return { job, uploading, error, upload }
}
