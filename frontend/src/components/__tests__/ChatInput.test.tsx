import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatInput } from '../ChatInput'

describe('ChatInput', () => {
  it('shows Send by default', () => {
    render(<ChatInput onSend={() => {}} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
  })

  it('morphs into Stop while streaming', () => {
    const onStop = vi.fn()
    render(<ChatInput onSend={() => {}} streaming onStop={onStop} />)
    const btn = screen.getByRole('button', { name: /stop/i })
    expect(btn).toBeInTheDocument()
    fireEvent.click(btn)
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('Stop button is enabled even when textarea is empty', () => {
    render(<ChatInput onSend={() => {}} streaming onStop={() => {}} />)
    expect(screen.getByRole('button', { name: /stop/i })).not.toBeDisabled()
  })
})
