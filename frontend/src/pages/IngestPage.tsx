import { IngestDropzone } from '../components/IngestDropzone'
import { ErrorBanner } from '../components/ErrorBanner'
import { useIngest } from '../hooks/useIngest'

export function IngestPage() {
  const { job, uploading, upload, error } = useIngest()

  return (
    <div className="px-4 sm:px-8 py-6 sm:py-8 mx-auto max-w-xl pb-safe">
      <h1 className="font-serif text-lg sm:text-xl font-medium text-near-black mb-1">Add Document</h1>
      <p className="text-sm text-stone-gray font-sans mb-6">
        Upload a <code className="bg-parchment px-1 rounded text-near-black">.md</code> file.
        The AI will compile it into the wiki automatically.
      </p>
      {error && (
        <div className="mb-4">
          <ErrorBanner error={error} />
        </div>
      )}
      <IngestDropzone onDrop={upload} job={job} uploading={uploading} />
    </div>
  )
}
