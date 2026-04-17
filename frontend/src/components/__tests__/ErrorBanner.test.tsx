import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ErrorBanner } from '../ErrorBanner'
import { ApiError } from '../../lib/api'

describe('ErrorBanner', () => {
  it('renders nothing when error is null', () => {
    const { container } = render(<ErrorBanner error={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders message and request id', () => {
    const err = new ApiError({ code: 'NOT_FOUND', message: 'Missing.', requestId: '01HREQ', status: 404 })
    render(<ErrorBanner error={err} />)
    expect(screen.getByText('Missing.')).toBeInTheDocument()
    expect(screen.getByText(/01HREQ/)).toBeInTheDocument()
  })

  it('shows Retry when onRetry provided and calls it', async () => {
    const err = new ApiError({ code: 'INTERNAL_ERROR', message: 'Oops.', requestId: null, status: 500 })
    const onRetry = vi.fn()
    render(<ErrorBanner error={err} onRetry={onRetry} />)
    const btn = screen.getByRole('button', { name: /retry/i })
    await userEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
