import { IngestDropzone } from '../components/IngestDropzone'
import { ErrorBanner } from '../components/ErrorBanner'
import { useIngest } from '../hooks/useIngest'

export function IngestPage() {
  const { job, uploading, upload, error } = useIngest()

  return (
    <div className="h-full overflow-y-auto pb-safe">
      <div className="max-w-[680px] mx-auto px-5 sm:px-8 py-8">
        <header className="mb-6">
          <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-dim">
            <span
              aria-hidden
              className="inline-block w-4 border-t"
              style={{ borderColor: 'var(--color-fg-dim)' }}
            />
            Ingest
          </span>
          <h1
            className="font-serif text-[26px] leading-[1.15] tracking-[-0.02em] mt-2 mb-2 text-fg"
            style={{ fontVariationSettings: '"opsz" 48', fontWeight: 500 }}
          >
            Add a document to the wiki
          </h1>
          <p
            className="font-serif text-[16px] leading-[1.6] text-fg-muted"
            style={{ fontVariationSettings: '"opsz" 18' }}
          >
            Upload a markdown file — the system reads it, compiles it against
            existing pages, and publishes the result so anyone on your team can
            ask about it.
          </p>
        </header>

        {error && (
          <div className="mb-4">
            <ErrorBanner error={error} />
          </div>
        )}

        <IngestDropzone onDrop={upload} job={job} uploading={uploading} />
      </div>
    </div>
  )
}
