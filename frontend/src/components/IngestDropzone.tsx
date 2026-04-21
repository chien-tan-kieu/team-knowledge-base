import { useCallback, useState } from 'react'
import type { IngestJob } from '../lib/types'

interface Props {
  onDrop: (file: File) => void
  job: IngestJob | null
  uploading: boolean
}

type Stage = 'upload' | 'parse' | 'compile' | 'publish'

function stageOf(job: IngestJob | null): Stage {
  if (!job) return 'upload'
  if (job.status === 'pending') return 'parse'
  if (job.status === 'running') return 'compile'
  return 'publish'
}

const STAGES: Array<{ key: Stage; title: string; desc: string }> = [
  { key: 'upload', title: 'Upload', desc: 'Drop a .md file to begin.' },
  { key: 'parse', title: 'Parse', desc: 'Extracting structure and prose.' },
  { key: 'compile', title: 'Compile', desc: 'Folding new facts into the wiki.' },
  { key: 'publish', title: 'Publish', desc: 'Live and searchable.' },
]

function stageIndex(s: Stage) {
  return STAGES.findIndex(x => x.key === s)
}

export function IngestDropzone({ onDrop, job, uploading }: Props) {
  const [hover, setHover] = useState(false)
  const current = stageOf(job)
  const currentIdx = stageIndex(current)
  const failed = job?.status === 'failed'

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setHover(true)
  }, [])

  const handleDragLeave = useCallback(() => setHover(false), [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setHover(false)
      const file = e.dataTransfer.files[0]
      if (file && file.name.endsWith('.md')) onDrop(file)
    },
    [onDrop],
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onDrop(file)
    },
    [onDrop],
  )

  return (
    <div className="flex flex-col gap-6">
      {/* Dropzone */}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'relative flex flex-col items-center justify-center gap-3 rounded-2xl p-10 sm:p-14 cursor-pointer transition-[background,transform] duration-200 ease-out',
          hover ? 'scale-[1.005]' : '',
        ].join(' ')}
        style={{
          background: hover
            ? 'var(--color-surface)'
            : 'var(--color-canvas)',
          border: '2px dashed var(--color-line-strong)',
        }}
      >
        <span
          aria-hidden
          className="w-14 h-14 grid place-items-center rounded-2xl text-accent"
          style={{
            background: 'rgba(201,100,66,0.1)',
            boxShadow: 'var(--shadow-ring)',
          }}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M7 10l5-5 5 5M12 15V5"
            />
          </svg>
        </span>
        <span
          className="font-serif text-[18px] text-fg text-center"
          style={{ fontVariationSettings: '"opsz" 18', fontWeight: 500 }}
        >
          Drop a markdown file here
        </span>
        <span className="text-[13px] text-fg-muted font-sans text-center">
          or{' '}
          <span className="text-accent underline underline-offset-[3px]">
            click to browse
          </span>{' '}
          — accepts <code className="font-mono bg-sand text-fg px-1 rounded">.md</code>
        </span>
        <input
          type="file"
          accept=".md"
          className="hidden"
          onChange={handleFileInput}
          disabled={uploading}
        />
      </label>

      {/* Pipeline */}
      {job && (
        <div
          className="bg-surface rounded-2xl p-5 flex flex-col gap-4"
          style={{ boxShadow: 'var(--shadow-ring)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col min-w-0">
              <span className="font-mono text-[11.5px] text-fg-dim truncate">
                {job.filename}
              </span>
              <span
                className="font-serif text-[15px] text-fg"
                style={{ fontVariationSettings: '"opsz" 14', fontWeight: 500 }}
              >
                {failed
                  ? 'Something went wrong'
                  : job.status === 'done'
                    ? 'Your wiki is ready'
                    : 'Compiling your knowledge base'}
              </span>
            </div>
            <span
              className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em]"
              style={{
                color: failed
                  ? 'var(--color-error-crimson)'
                  : job.status === 'done'
                    ? '#76a35c'
                    : 'var(--color-accent)',
              }}
            >
              <span
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{
                  background: failed
                    ? 'var(--color-error-crimson)'
                    : job.status === 'done'
                      ? '#76a35c'
                      : 'var(--color-accent)',
                  boxShadow: `0 0 0 3px ${
                    failed
                      ? 'rgba(181,51,51,0.18)'
                      : job.status === 'done'
                        ? 'rgba(118,163,92,0.2)'
                        : 'rgba(201,100,66,0.18)'
                  }`,
                }}
              />
              {failed ? 'failed' : job.status === 'done' ? 'done' : 'running'}
            </span>
          </div>

          {/* Steps */}
          <ol className="grid grid-cols-4 gap-2.5">
            {STAGES.map((s, i) => {
              const reached = i <= currentIdx
              const active = i === currentIdx && job.status !== 'done' && !failed
              const complete = i < currentIdx || (i === currentIdx && job.status === 'done')
              const color = failed && reached
                ? 'var(--color-error-crimson)'
                : complete
                  ? '#76a35c'
                  : active
                    ? 'var(--color-accent)'
                    : 'var(--color-line-strong)'
              return (
                <li key={s.key} className="flex flex-col gap-1.5 min-w-0">
                  <span
                    className="relative h-[3px] rounded-full overflow-hidden transition-[background,opacity] duration-500"
                    style={{ background: color, opacity: reached ? 1 : 0.5 }}
                  >
                    {active && !failed && (
                      <span
                        data-shimmer="true"
                        aria-hidden
                        className="absolute inset-0"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
                          animation: 'ingest-shimmer 2.8s ease-in-out infinite',
                        }}
                      />
                    )}
                  </span>
                  <span
                    className="text-[10.5px] font-medium uppercase tracking-[0.14em]"
                    style={{
                      color: reached ? 'var(--color-fg)' : 'var(--color-fg-dim)',
                    }}
                  >
                    {s.title}
                  </span>
                  <span className="text-[11.5px] text-fg-muted font-sans hidden sm:block">
                    {s.desc}
                  </span>
                </li>
              )
            })}
          </ol>

          {failed && job.error && (
            <p className="text-[13px] font-sans text-fg-muted">
              <span
                className="font-medium"
                style={{ color: 'var(--color-error-crimson)' }}
              >
                Error:
              </span>{' '}
              {job.error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
