import type { ReactElement } from 'react'
import type { ThreadItem } from '../../shared/types.ts'
import { RUNG_LABEL } from '../../shared/leetcode.ts'
import { api } from '../api.ts'

/**
 * The companion is a voice in the margin. The student's own words come back
 * quieter on the right. Evidence and sources appear as chips below.
 */
export function Line({ item }: { item: ThreadItem }): ReactElement {
  if (item.speaker === 'user') {
    return <p className="mine arriving">{item.text}</p>
  }
  return (
    <div className="arriving">
      <Said item={item} />
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
  const parts = item.text.split(/```[a-zA-Z]*\n?/)
  const caret = item.streaming ? ' caret' : ''
  if (parts.length < 2) return <p className={`said${caret}`}>{item.text}</p>
  return (
    <>
      {parts.map((part, index) =>
        // The fences alternate, so every odd part is what sat between them.
        index % 2 === 1 ? (
          <pre key={index} className="scroller code">
            {part.replace(/\n$/, '')}
          </pre>
        ) : (
          part.trim() && (
            <p key={index} className={`said${index === parts.length - 1 ? caret : ''}`}>
              {part.trim()}
            </p>
          )
        )
      )}
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
        </button>
      ))}
    </div>
  )
}
