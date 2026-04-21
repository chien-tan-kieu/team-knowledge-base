import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { IngestDropzone } from '../IngestDropzone'
import type { IngestJob } from '../../lib/types'

function job(status: IngestJob['status'], error: string | null = null): IngestJob {
  return { job_id: 'j1', filename: 'a.md', status, error }
}

describe('IngestDropzone shimmer', () => {
  it('renders the shimmer element on the active Compile stage while running', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('running')} uploading={false} />
    )
    const shimmers = container.querySelectorAll('[data-shimmer="true"]')
    expect(shimmers).toHaveLength(1)
  })

  it('does not render a shimmer element when the job has failed', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('failed', 'boom')} uploading={false} />
    )
    expect(container.querySelectorAll('[data-shimmer="true"]')).toHaveLength(0)
  })

  it('does not render a shimmer element when the job is done', () => {
    const { container } = render(
      <IngestDropzone onDrop={() => {}} job={job('done')} uploading={false} />
    )
    expect(container.querySelectorAll('[data-shimmer="true"]')).toHaveLength(0)
  })
})
