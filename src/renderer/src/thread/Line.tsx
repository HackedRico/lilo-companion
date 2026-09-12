import type { ReactElement } from 'react'
import type { ThreadItem } from '../../../shared/types.ts'
import { api } from '../api.ts'

/**
 * Four treatments, because four different things are speaking. The companion is
 * a voice in the margin. The student's own words come back quieter. Anything
 * from the working world arrives as a document on warm paper. A review is a
 * proof mark: a rule down the side, in the colour of its verdict.
 */
export function Line({ item }: { item: ThreadItem }): ReactElement {
  if (item.speaker === 'user') {
    return <p className="mine arriving">{item.text}</p>
  }
  if (item.speaker === 'stakeholder') return <Dispatch item={item} />
  if (item.speaker === 'reviewer') return <Review item={item} />
  return (
    <div className="arriving">
      <p className={`said${item.streaming ? ' caret' : ''}`}>{item.text}</p>
      <Evidence item={item} />
      <Sources item={item} />
    </div>
  )
}

function Dispatch({ item }: { item: ThreadItem }): ReactElement {
  const attachment = item.attachment
  return (
    <article className="dispatch arriving">
      {item.from && (
        <header className="dispatch-head">
          <span className="dispatch-from">{item.from.name}</span>
          <span className="dispatch-role">{item.from.role}</span>
        </header>
      )}
      <p className={`dispatch-body${item.streaming ? ' caret' : ''}`}>{item.text}</p>
      {attachment && attachment.type !== 'none' && (
        <pre className="scroller">{attachment.content}</pre>
      )}
    </article>
  )
}

function Review({ item }: { item: ThreadItem }): ReactElement {
  return (
    <div className="arriving">
      {item.priorAnswer && <p className="prior">{item.priorAnswer.text}</p>}
      <div
        className="review"
        data-verdict={item.verdict === 'ship_it' ? 'ship' : item.verdict ? 'not-yet' : undefined}
      >
        {item.from && (
          <div className="review-who">
            <span className="dispatch-from" style={{ color: 'var(--ink)' }}>
              {item.from.name}
            </span>
            <span className="meta">{item.from.role}</span>
          </div>
        )}
        <p className={`said said-quiet${item.streaming ? ' caret' : ''}`}>{item.text}</p>
      </div>
    </div>
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
