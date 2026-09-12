import { useEffect, useRef, useState, type ReactElement } from 'react'
import { CHECKED } from '../../../shared/settings.ts'
import { api } from '../api.ts'

/** Long enough that typing a model name is not one request per letter. */
const SETTLE_MS = 220

/**
 * The list comes from the endpoint's own /models, which is the only way to
 * offer one without knowing who is on the other end. Anything can still be
 * typed, because not every endpoint publishes a list.
 */
export function ModelField({
  value,
  onPick
}: {
  value: string
  onPick: (next: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [found, setFound] = useState<string[]>([])
  const [detail, setDetail] = useState('')
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => setDraft(value), [value])

  useEffect(() => {
    if (!open) return undefined
    const timer = setTimeout(() => {
      void api.listModels(draft === value ? '' : draft).then((reply) => {
        setFound(reply.models)
        setDetail(reply.detail)
      })
    }, SETTLE_MS)
    return () => clearTimeout(timer)
  }, [draft, open, value])

  useEffect(() => {
    if (!open) return undefined
    const away = (event: MouseEvent): void => {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const choose = (id: string): void => {
    setDraft(id)
    setOpen(false)
    if (id !== value) onPick(id)
  }

  return (
    <div className="relative" ref={box}>
      <input
        className="input input-mono"
        title={value}
        value={draft}
        placeholder="owner/model-name"
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') choose(draft.trim())
          if (event.key === 'Escape') {
            setDraft(value)
            setOpen(false)
          }
        }}
        onBlur={() => {
          // A click on the list is handled there; anything else commits.
          if (!open) return
          window.setTimeout(() => {
            if (draft.trim() && draft !== value) onPick(draft.trim())
          }, 150)
        }}
      />
      {open && (found.length > 0 || detail) && (
        <div className="menu scroller">
          {detail && (
            <p className="px-2 py-1.5 text-[11.5px]" style={{ color: 'var(--faint)' }}>
              No list from there. Type the name instead.
            </p>
          )}
          {found.map((id) => (
            <button
              key={id}
              className="input-mono"
              style={{ color: id === value ? 'var(--accent)' : 'var(--ink)' }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(id)}
            >
              <span className="min-w-0 flex-1 truncate">{id}</span>
              {CHECKED.has(id) && <span className="meta shrink-0">checked</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
