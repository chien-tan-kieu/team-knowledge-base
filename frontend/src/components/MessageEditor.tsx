import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'

interface Props {
  initial: string
  onSave: (text: string) => void
  onCancel: () => void
}

export function MessageEditor({ initial, onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

  function handleSave() {
    const trimmed = value.trim()
    if (!trimmed) return
    onSave(trimmed)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSave()
    }
  }

  return (
    <div className="w-full flex flex-col gap-2">
      <textarea
        ref={ref}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={1}
        className="w-full bg-ivory border border-border-warm rounded-lg p-2 text-sm font-sans text-near-black resize-none outline-none focus:border-terracotta"
      />
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-sm font-sans text-stone-gray hover:text-near-black px-3 py-1 rounded"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!value.trim()}
          className="bg-terracotta text-ivory text-sm font-medium font-sans px-3 py-1 rounded disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
        >
          Save
        </button>
      </div>
    </div>
  )
}
