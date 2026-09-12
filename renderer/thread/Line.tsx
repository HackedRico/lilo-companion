import type { ReactElement } from 'react'
import type { ThreadItem } from '../../shared/types.ts'
import { RUNG_LABEL } from '../../shared/leetcode.ts'
import { api } from '../api.ts'
import { DryRun } from './DryRun.tsx'

/**
 * The companion is a voice in the margin. The student's own words come back
 * quieter on the right. A dry run is drawn under the words that introduce it,
 * and evidence and sources appear as chips below.
 */
export function Line({ item }: { item: ThreadItem }): ReactElement {
  if (item.speaker === 'user') {
    // A file is still the student speaking, so it sits on their side, but it
    // is a thing handed over rather than something said.
    if (item.file) {
      return (
        <p className="mine arriving handed">
          <Paper />
          {item.file}
        </p>
      )
    }
    return <p className="mine arriving">{item.text}</p>
  }
  return (
    <div className="arriving">
      <Said item={item} />
      {item.trace && <DryRun trace={item.trace} />}
      {/* Every hint carries its rung, so the student can see what it cost them. */}
      {item.rung !== undefined && <span className="meta">{RUNG_LABEL[item.rung]}</span>}
      <Evidence item={item} />
      <Sources item={item} />
    </div>
  )
}

/**
 * What the companion said. The top of the ladder hands over code, and a fenced
 * block reads as code rather than as prose with backticks in it.
 */
function Said({ item }: { item: ThreadItem }): ReactElement {
  // Any language tag, not only letters: python3 and c++ are tags too.
  const parts = item.text.split(/```[^\n]*\n?/)
  const caret = item.streaming ? ' caret' : ''
  if (parts.length < 2) return <p className={`said${caret}`}>{item.text}</p>
  const spoken = parts.map((part, index) => ({ part, code: index % 2 === 1 })).filter((piece) => piece.part.trim())
  return (
    <>
      {spoken.map((piece, index) =>
        // The fences alternate, so every odd part is what sat between them.
        piece.code ? (
          <pre key={index} className="scroller code">
            {piece.part.replace(/\n$/, '')}
          </pre>
        ) : (
          <p key={index} className={`said${index === spoken.length - 1 ? caret : ''}`}>
            {piece.part.trim()}
          </p>
        )
      )}
      {/* A block still arriving keeps the caret, which a pre cannot carry. */}
      {item.streaming && spoken.at(-1)?.code && <p className="said caret" />}
    </>
  )
}

/** The citation: the sentence, and the posting it was lifted from. */
function Evidence({ item }: { item: ThreadItem }): ReactElement | null {
  const evidence = item.evidence
  if (!evidence) return null
  return (
    <button className="evidence" onClick={() => api.openLink(evidence.url)} title={evidence.url}>
      <span className="evidence-quote">{evidence.sentence.text}</span>
      <span className="evidence-source">
        <span className="evidence-company">{evidence.company}</span>
        <span className="evidence-role">{evidence.title}</span>
      </span>
    </button>
  )
}

/** Where a claim came from, when there is more than one posting behind it. */
function Sources({ item }: { item: ThreadItem }): ReactElement | null {
  if (!item.sources || item.sources.length === 0) return null
  return (
    <div className="chip-row">
      {item.sources.map((source) => (
        <button
          key={source.sentence.id}
          className="chip"
          title={source.sentence.text}
          onClick={() => api.openLink(source.url)}
        >
          {source.company}
          {/* Who wants it is the company and the job, and the job is the half a student is reading for. */}
          {source.title && <span className="chip-role">{source.title}</span>}
        </button>
      ))}
    </div>
  )
}

/** A page, for a file the student handed over. */
function Paper(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0 fill-none stroke-current opacity-70"
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 1.75H4.25v12.5h7.5V4.5z" />
      <path d="M9 1.75V4.5h2.75" />
    </svg>
  )
}
