import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MessageEditor } from '../MessageEditor'

describe('MessageEditor', () => {
  it('prefills textarea with initial content', () => {
    render(<MessageEditor initial="hi" onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('textbox')).toHaveValue('hi')
  })

  it('Save invokes onSave with trimmed value', () => {
    const onSave = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={() => {}} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  updated  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    expect(onSave).toHaveBeenCalledWith('updated')
  })

  it('Cancel invokes onCancel, not onSave', () => {
    const onSave = vi.fn()
    const onCancel = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Save disabled when value is blank', () => {
    render(<MessageEditor initial="" onSave={() => {}} onCancel={() => {}} />)
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })
})
