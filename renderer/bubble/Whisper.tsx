import { useEffect, type ReactElement } from 'react'
import type { Rect, Whisper as WhisperLine } from '../../shared/types.ts'
import { api } from '../api.ts'

/** Long enough to read in passing, short enough to stay ignorable. */
const LINGER = 8000

export function Whisper({ rect, line }: { rect: Rect; line: WhisperLine }): ReactElement {
  useEffect(() => {
    const timer = setTimeout(() => api.dismissWhisper(), LINGER)
    return () => clearTimeout(timer)
  }, [line.id])

  return (
    <button
      data-solid=""
      className="arriving absolute flex items-center rounded-2xl border px-4 text-left leading-snug"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        background: 'var(--surface)',
        borderColor: 'var(--rule)',
        boxShadow: 'var(--lift-high)',
        color: 'var(--ink)'
      }}
      onClick={() => api.expand(true)}
    >
      {line.text}
    </button>
  )
}
