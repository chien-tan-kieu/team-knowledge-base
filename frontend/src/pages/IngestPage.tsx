import { useEffect, useRef } from "react";
import { IngestDropzone } from "../components/IngestDropzone";
import { useIngest } from "../hooks/useIngest";
import { useVaultSync } from "../hooks/useVaultSync";

export function IngestPage() {
  const { job, uploading, upload } = useIngest();
  const { triggerSync, syncJobs, syncing } = useVaultSync();
  const didSyncRef = useRef<string | null>(null);

  useEffect(() => {
    if (job?.status === "done" && didSyncRef.current !== job.job_id) {
      didSyncRef.current = job.job_id;
      triggerSync();
    }
  }, [job?.status, job?.job_id, triggerSync]);

  return (
    <div className="h-full overflow-y-auto pb-safe">
      <div className="max-w-[680px] mx-auto px-5 sm:px-8 py-8">
        <header className="mb-6">
          <span className="inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-fg-dim">
            <span
              aria-hidden
              className="inline-block w-4 border-t"
              style={{ borderColor: "var(--color-fg-dim)" }}
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

        <IngestDropzone onDrop={upload} job={job} uploading={uploading} />

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={triggerSync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium rounded border border-border-cream text-fg hover:bg-warm-sand disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {syncing ? "Syncing…" : "Sync vault"}
          </button>
          {syncing && (
            <span className="text-[13px] text-fg-muted">
              Compiling vault files…
            </span>
          )}
        </div>

        {syncJobs.length > 0 && (
          <ul className="mt-4 space-y-1">
            {syncJobs.map((j) => (
              <li key={j.job_id} className="text-[13px] text-fg-muted flex items-center gap-2">
                <span
                  className={
                    j.status === "done"
                      ? "text-green-600"
                      : j.status === "failed"
                      ? "text-red-600"
                      : "text-fg-dim"
                  }
                >
                  {j.status === "done" ? "done" : j.status === "failed" ? "failed" : "pending"}
                </span>
                {j.filename}
                {j.error && (
                  <span className="text-red-600 text-[12px]">{j.error}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
