import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { Trace, TraceStep } from '../../shared/leetcode.ts'

/** How long a step stays up when the run plays itself. */
const BEAT_MS = 1100

/**
 * Every cell is the width of the widest item, so where a pointer stands is
 * arithmetic and it can slide there rather than jump.
 */
const CELL_MIN = 26
const CELL_PAD = 14
const CHAR_PX = 7
const CELL_GAP = 4
const POINTER_ROW = 15

/**
 * A dry run, stepped through at the student's own pace or played a beat at
 * a time. The pointers slide along the sequence, the table lights the current
 * step, and the note says what happened there. Nothing here asks a model: the
 * whole picture arrived with the hint, and the gate has already read it.
 */
export function DryRun({ trace }: { trace: Trace }): ReactElement | null {
  const [step, setStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const last = trace.steps.length - 1
  const current = trace.steps[step]

  useEffect(() => {
    if (!playing) return
    const beat = setInterval(() => setStep((at) => Math.min(at + 1, last)), BEAT_MS)
    return () => clearInterval(beat)
  }, [playing, last])

  // The run stops on its last step rather than looping.
  useEffect(() => {
    if (step === last) setPlaying(false)
  }, [step, last])

  if (!current) return null

  /** A step chosen by hand takes the run out of play. */
  const go = (to: number): void => {
    setPlaying(false)
    setStep(to)
  }
  const play = (): void => {
    // Pressing play on the last step starts the run over.
    if (step === last) setStep(0)
    setPlaying(true)
  }

  return (
    <figure className="dryrun">
      <figcaption className="dryrun-input">{trace.input}</figcaption>
      {trace.items.length > 0 && <Sequence steps={trace.steps} items={trace.items} step={step} />}
      {trace.columns.length > 0 && (
        <div className="scroller dryrun-scroll">
          <table className="dryrun-table">
            <thead>
              <tr>
                <th aria-label="Step" />
                {trace.columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trace.steps.map((row, index) => (
                <tr key={index} data-current={index === step ? '' : undefined} onClick={() => go(index)}>
                  <th>{index + 1}</th>
                  {row.values.map((value, column) => (
                    <td key={column}>{value}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {/* Keyed on the step, so each note arrives the way a line does. */}
      <p key={step} className="dryrun-note arriving">
        {current.note}
        {typeof current.line === 'number' && <span className="meta dryrun-line">line {current.line}</span>}
      </p>
      <div className="dryrun-nav">
        <button className="dryrun-step" aria-label="Previous step" disabled={step === 0} onClick={() => go(step - 1)}>
          <Chevron back />
        </button>
        <button
          className="dryrun-step"
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => (playing ? setPlaying(false) : play())}
        >
          {playing ? <Pause /> : <Play />}
        </button>
        <button className="dryrun-step" aria-label="Next step" disabled={step === last} onClick={() => go(step + 1)}>
          <Chevron />
        </button>
        <span className="meta">
          Step {step + 1} of {trace.steps.length}
        </span>
      </div>
    </figure>
  )
}

/**
 * The cells the pointers walk. Each pointer is drawn once, in its own row
 * under the cells, and slides to the cell it stands on at this step. A
 * pointer that is not placed at a step stays where it last stood and fades,
 * so it never jumps back to the start.
 */
function Sequence({ steps, items, step }: { steps: TraceStep[]; items: string[]; step: number }): ReactElement {
  const strip = useRef<HTMLDivElement>(null)
  const pointers = useMemo(() => [...new Set(steps.flatMap((row) => row.marks.map((mark) => mark.label)))], [steps])
  const widest = Math.max(1, ...items.map((item) => item.length))
  const cell = Math.max(CELL_MIN, widest * CHAR_PX + CELL_PAD)
  const pitch = cell + CELL_GAP
  const marks = steps[step]?.marks ?? []
  // A pointer's name is centred on its cell, so a name wider than the cell
  // would hang past the strip's edge and be clipped; the strip is padded by
  // that overhang on both sides.
  const longest = Math.max(1, ...pointers.map((label) => label.length))
  const overhang = Math.max(0, Math.ceil((longest * CHAR_PX + 2 - cell) / 2))

  // A long sequence scrolls sideways to keep the first pointer in view.
  useEffect(() => {
    const element = strip.current
    const first = marks[0]
    if (!element || !first) return
    const left = first.at * pitch + overhang
    if (left < element.scrollLeft) element.scrollTo({ left, behavior: 'smooth' })
    else if (left + cell > element.scrollLeft + element.clientWidth) {
      element.scrollTo({ left: left + cell - element.clientWidth, behavior: 'smooth' })
    }
  }, [marks, pitch, cell, overhang])

  return (
    <div className="scroller dryrun-scroll" ref={strip}>
      <div className="dryrun-seq" style={{ width: items.length * pitch - CELL_GAP + overhang * 2, padding: `0 ${overhang}px` }}>
        <ol className="dryrun-cells" style={{ gap: CELL_GAP }}>
          {items.map((item, index) => (
            <li
              key={index}
              className="dryrun-item"
              style={{ width: cell }}
              data-marked={marks.some((mark) => mark.at === index) ? '' : undefined}
            >
              {item}
            </li>
          ))}
        </ol>
        <div className="dryrun-pointers" style={{ height: pointers.length * POINTER_ROW }}>
          {pointers.map((label, row) => {
            const at = standing(steps, step, label)
            return (
              <span
                key={label}
                className="dryrun-pointer"
                data-off={marks.some((mark) => mark.label === label) ? undefined : ''}
                style={{ left: (at ?? 0) * pitch + cell / 2, top: row * POINTER_ROW }}
              >
                {label}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Where a pointer stands at a step, or where it last stood before it, or null if it has not yet. */
function standing(steps: TraceStep[], step: number, label: string): number | null {
  for (let index = step; index >= 0; index -= 1) {
    const mark = steps[index]?.marks.find((candidate) => candidate.label === label)
    if (mark) return mark.at
  }
  return null
}

function Chevron({ back = false }: { back?: boolean }): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-none stroke-current" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={back ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
    </svg>
  )
}

function Play(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden>
      <path d="M5 3.5v9l7-4.5z" />
    </svg>
  )
}

function Pause(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 fill-current" aria-hidden>
      <path d="M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z" />
    </svg>
  )
}
