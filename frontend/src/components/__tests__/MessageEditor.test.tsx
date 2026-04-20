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

  it('Escape invokes onCancel', () => {
    const onCancel = vi.fn()
    render(<MessageEditor initial="hi" onSave={() => {}} onCancel={onCancel} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Cmd+Enter invokes onSave with trimmed value', () => {
    const onSave = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={() => {}} />)
    const ta = screen.getByRole('textbox')
    fireEvent.change(ta, { target: { value: '  updated  ' } })
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true })
    expect(onSave).toHaveBeenCalledWith('updated')
  })

  it('plain Enter does not save', () => {
    const onSave = vi.fn()
    render(<MessageEditor initial="hi" onSave={onSave} onCancel={() => {}} />)
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
  })
})
