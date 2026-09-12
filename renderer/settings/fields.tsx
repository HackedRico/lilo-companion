import { useState, type ReactElement, type ReactNode } from 'react'

/** A group inside a tab, for the one or two things that stand apart. */
export function Group({
  title,
  note,
  children
}: {
  title: string
  note?: string
  children: ReactNode
}): ReactElement {
  return (
    <section className="group">
      <h2 className="group-title">{title}</h2>
      {note && <p className="lede">{note}</p>}
      {children}
    </section>
  )
}

/** The label sits above its field, so nothing is squeezed into a narrow column. */
export function Field({
  label,
  hint,
  badge,
  wide,
  children
}: {
  label: string
  hint?: string
  /** Sits at the end of the label row, where it cannot collide with a value. */
  badge?: string
  /** Takes the whole measure rather than half of it. */
  wide?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <div className={`field${wide ? ' field-wide' : ''}`}>
      <label>
        {label}
        {badge && <span className="meta">{badge}</span>}
      </label>
      {children}
      {hint && (
        <p className="mt-1.5 text-[11.5px] leading-[1.55]" style={{ color: 'var(--faint)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function TextInput({
  value,
  placeholder,
  mono,
  onCommit
}: {
  value: string
  placeholder?: string
  mono?: boolean
  onCommit: (next: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)
  return (
    <input
      className={`input${mono ? ' input-mono' : ''}`}
      value={draft}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => setDraft(event.target.value)}
      // One write per edit, rather than one per keystroke.
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(value)
      }}
    />
  )
}

export function Action({
  children,
  onClick,
  tone,
  title,
  on,
  disabled
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'danger'
  title?: string
  /** Marks the one already chosen, where the buttons stand for a choice. */
  on?: boolean
  disabled?: boolean
}): ReactElement {
  return (
    <button
      className="action"
      data-tone={tone}
      data-on={on ? 'true' : undefined}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function KeyRow({
  state,
  envName,
  absent,
  onSet
}: {
  state: { set: boolean; hint: string; fromEnv: boolean }
  envName: string
  absent?: string
  onSet: (value: string) => void
}): ReactElement {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <input
        className="input input-mono"
        type="password"
        autoFocus
        placeholder="Paste it and press enter"
        spellCheck={false}
        onBlur={(event) => {
          const value = event.target.value.trim()
          if (value) onSet(value)
          setEditing(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') setEditing(false)
        }}
      />
    )
  }
  return (
    <div className="flex items-center gap-2">
      <span
        className="min-w-0 flex-1 truncate text-[12px]"
        style={{ color: state.set ? 'var(--ink)' : 'var(--faint)' }}
      >
        {state.set ? (
          <>
            Set <span className="input-mono">{state.hint}</span>
            {state.fromEnv && <span style={{ color: 'var(--faint)' }}> from {envName}</span>}
          </>
        ) : (
          (absent ?? 'Not set')
        )}
      </span>
      <Action onClick={() => setEditing(true)}>{state.set ? 'Replace' : 'Add'}</Action>
      {state.set && !state.fromEnv && <Action onClick={() => onSet('')}>Clear</Action>}
    </div>
  )
}
