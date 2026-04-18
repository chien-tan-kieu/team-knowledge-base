import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { ChatMessage } from '../ChatMessage'
import type { ChatMessage as ChatMessageType } from '../../lib/types'

const userMsg: ChatMessageType = {
  id: '1', role: 'user', content: 'How do I deploy?', citations: []
}

const assistantMsg: ChatMessageType = {
  id: '2', role: 'assistant', content: 'Run `make deploy`.', citations: [{ slug: 'deploy-process', start: 1, end: 5 }]
}

describe('ChatMessage', () => {
  it('renders user message content', () => {
    render(<MemoryRouter><ChatMessage message={userMsg} /></MemoryRouter>)
    expect(screen.getByText('How do I deploy?')).toBeInTheDocument()
  })

  it('renders assistant message content', () => {
    render(<MemoryRouter><ChatMessage message={assistantMsg} /></MemoryRouter>)
    expect(screen.getByText(/make deploy/)).toBeInTheDocument()
  })

  it('renders citation tags for assistant messages', () => {
    render(<MemoryRouter><ChatMessage message={assistantMsg} /></MemoryRouter>)
    expect(screen.getByText('deploy-process:1-5')).toBeInTheDocument()
  })

  it('does not render citations for user messages', () => {
    render(<MemoryRouter><ChatMessage message={userMsg} /></MemoryRouter>)
    expect(screen.queryByText('deploy-process:1-5')).not.toBeInTheDocument()
  })
})
