import { useCallback } from 'react'
import type { IngestJob } from '../lib/types'

interface Props {
  onDrop: (file: File) => void
  job: IngestJob | null
  uploading: boolean
}

const STATUS_LABELS: Record<IngestJob['status'], string> = {
  pending: 'Queued…',
  running: 'Compiling wiki pages…',
  done: 'Done — wiki updated.',
  failed: 'Failed.',
}

const STATUS_COLORS: Record<IngestJob['status'], string> = {
  pending: 'text-stone-gray',
  running: 'text-terracotta',
  done: 'text-near-black',
  failed: 'text-error-crimson',
}

export function IngestDropzone({ onDrop, job, uploading }: Props) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.md')) onDrop(file)
  }, [onDrop])

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onDrop(file)
  }, [onDrop])

  return (
    <div className="flex flex-col gap-6">
      <label
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-border-warm rounded-xl p-12 cursor-pointer bg-ivory hover:border-terracotta transition-colors"
      >
        <span className="text-4xl">📄</span>
        <span className="text-sm text-olive-gray font-sans text-center">
          Drag a <code className="bg-parchment px-1 rounded text-near-black">.md</code> file here,
          or <span className="text-terracotta underline">click to browse</span>
        </span>
        <input
          type="file"
          accept=".md"
          className="hidden"
          onChange={handleFileInput}
          disabled={uploading}
        />
      </label>

      {job && (
        <div className="bg-ivory border border-border-cream rounded-xl p-4 font-sans text-sm">
          <div className="flex justify-between items-center">
            <span className="text-near-black font-medium">{job.filename}</span>
            <span className={STATUS_COLORS[job.status]}>{STATUS_LABELS[job.status]}</span>
          </div>
          {job.error && (
            <p className="mt-2 text-error-crimson text-xs">{job.error}</p>
          )}
        </div>
      )}
    </div>
  )
}
