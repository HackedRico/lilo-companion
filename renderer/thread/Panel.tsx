import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject
} from 'react'
import type { CompanionState, Placement, Rect, Suggestion } from '../../shared/types.ts'
import { api } from '../api.ts'
import { PANEL_MIN } from '../../shared/layout.ts'
import { trackPointer } from '../drag.ts'
import { Line } from './Line.tsx'

/** How tall the field takes itself, before anyone drags it. */
const GROWN = 200

/** A drag stops at one line, and never goes past what the panel can show. */
const SHORTEST = 44
const TALLEST = 300

/** The strip of conversation that stays visible however tall the field gets. */
const MIN_THREAD = 96

/** Below this much travel the grip was clicked rather than dragged. */
const GRAB = 3

/** Within this far of the bottom is still reading the newest line. */
const AT_BOTTOM = 4

export function Panel({
  rect,
  corner,
  state
}: {
  rect: Rect
  /** Which corner is free to drag: the one the orb is not standing next to. */
  corner: Placement
  state: CompanionState
}): ReactElement {
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const last = state.thread.at(-1)

  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = element.scrollHeight
  }, [state.thread.length, last?.text.length, state.composing])

  /**
   * Everything below the thread can take room from it: the field as it grows,
   * the reply chips as they arrive. That shortens the scroll port without
   * moving it, so the newest line slides out of sight and nothing brings it
   * back. Follow it down, unless the student has scrolled up to read something.
   */
  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const onScroll = (): void => {
      pinned.current = element.scrollHeight - element.clientHeight - element.scrollTop <= AT_BOTTOM
    }
    const observer = new ResizeObserver(() => {
      if (pinned.current) element.scrollTop = element.scrollHeight
    })
    element.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [])

  return (
    <section
      className="panel"
      data-solid=""
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      <header className="panel-head">
        <button className="lecture-button" title="Upload a lecture" onClick={() => api.openLecture()}>
          <span className="meta">Upload a lecture</span>
        </button>
        <span className="flex items-center gap-1">
          <button
            className="lecture-button flex items-center gap-1.5"
            aria-label="Settings"
            title="Settings"
            onClick={() => api.openPrefs()}
          >
            <Gear />
            <span className="meta">Settings</span>
          </button>
          <button className="icon-button" aria-label="Close" onClick={() => api.expand(false)}>
            <Cross />
          </button>
        </span>
      </header>

      <div className="scroller flex-1 overflow-y-auto" ref={scroller}>
        <div className="thread">
          {state.thread.length === 0 && !state.composing && (
            <p className="empty">
              Upload a lecture or paste your notes. I will tell you where it turns up at work.
            </p>
          )}
          {state.thread.map((item) => (
            <Line key={item.id} item={item} />
          ))}
          {state.composing && (
            <div className="dots" aria-label="Thinking">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>

      <Handle corner={corner} rect={rect} />

      <Replies suggestions={state.suggestions} />
      <Aim state={state} />
      <Composer state={state} room={scroller} panelHeight={rect.height} />
    </section>
  )
}

/**
 * The panel's free corner. The orb is the fixed point the layout is measured
 * from, so dragging this moves one corner and the window's edges follow it.
 * Screen coordinates, because that corner travels under the cursor as the panel
 * grows, and a local measurement would feed the gesture back into itself.
 */
function Handle({ corner, rect }: { corner: Placement; rect: Rect }): ReactElement {
  const [active, setActive] = useState(false)
  const grab = (event: ReactPointerEvent): void => {
    setActive(true)
    const started = { width: rect.width, height: rect.height }
    const outward = { x: corner.side === 'right' ? 1 : -1, y: corner.edge === 'down' ? 1 : -1 }
    let from = { x: 0, y: 0 }
    trackPointer(event, {
      onStart: (at) => {
        from = at
      },
      // Held above the minimum here as well as in the main process, so dragging
      // past it stops the panel rather than sending sizes nothing will accept.
      onMove: (at) =>
        api.resize({
          width: Math.max(PANEL_MIN.width, started.width + (at.x - from.x) * outward.x),
          height: Math.max(PANEL_MIN.height, started.height + (at.y - from.y) * outward.y)
        }),
      onEnd: () => {
        setActive(false)
        api.resizeEnd()
      }
    })
  }

  return (
    <div
      className="handle"
      data-side={corner.side}
      data-edge={corner.edge}
      data-active={active ? 'true' : undefined}
      role="separator"
      aria-label="Drag corner to resize panel"
      title="Drag corner to resize panel"
      onPointerDown={grab}
    >
      <div className="handle-grip" aria-hidden>
        <span className="grip-line grip-line-1" />
        <span className="grip-line grip-line-2" />
        <span className="grip-line grip-line-3" />
      </div>
    </div>
  )
}

/** Where what you type is going, whenever that is not the companion. */
function Aim({ state }: { state: CompanionState }): ReactElement | null {
  const { mode } = state.composer
  if (mode === 'chat') return null
  return (
    <div className="aim arriving">
      <Arrow />
      <span className="meta">
        {mode === 'leetcode' ? 'On the problem' : 'About you'}
      </span>
    </div>
  )
}

function Replies({ suggestions }: { suggestions: Suggestion[] }): ReactElement | null {
  if (suggestions.length === 0) return null
  return (
    <div className="tray flex flex-wrap gap-1.5 pb-0.5 pt-2.5">
      {suggestions.map((suggestion) => (
        <button key={suggestion.id} className="reply" onClick={() => api.send(suggestion.intent)}>
          {suggestion.text}
        </button>
      ))}
    </div>
  )
}

/**
 * Enter sends, shift and enter makes a new line, and it grows to fit a reply.
 * The grip on its top edge overrides that height, either way.
 */
function Composer({
  state,
  room,
  panelHeight
}: {
  state: CompanionState
  /** The thread's scroll port, which is the room the field grows into. */
  room: RefObject<HTMLDivElement | null>
  /** The panel answers to the display's work area, so this is not a constant. */
  panelHeight: number
}): ReactElement {
  const [draft, setDraft] = useState('')
  const [lift, setLift] = useState<number | null>(null)
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    field.current?.focus()
    return api.onFocusComposer(() => field.current?.focus())
  }, [])

  /**
   * The tallest the field can be and still leave a strip of thread showing.
   * The field and the scroll port divide one column of fixed height, so what
   * the field has now plus what the port has left is the same total whenever it
   * is asked. That makes this safe to read at any moment, and it needs no
   * arithmetic on the head, the chips or the aim line, which come and go.
   */
  const ceiling = (): number => {
    const element = field.current
    const port = room.current
    if (!element) return SHORTEST
    const slack = port ? port.clientHeight - MIN_THREAD : 0
    return Math.max(SHORTEST, element.getBoundingClientRect().height + slack)
  }

  // A dragged height belongs to the student, and the style prop carries it.
  useLayoutEffect(() => {
    const element = field.current
    if (!element || lift !== null) return
    // Read before the height is released: at `auto` the field takes its whole
    // content and the room being measured against it disappears.
    const most = Math.min(GROWN, ceiling())
    element.style.height = 'auto'
    // scrollHeight leaves the border out and box-sizing counts it, so add it back.
    const border = element.offsetHeight - element.clientHeight
    element.style.height = `${Math.min(element.scrollHeight + border, most)}px`
  }, [draft, lift])

  /**
   * A height dragged on a large panel has to come back down on a smaller one,
   * or the panel clips its own send button. This settles rather than corrects:
   * the scroll port bottoms out at zero and stops reporting how much room is
   * really missing, so each pass gives back what it can see and the next one
   * sees further. It ends because a pass either changes nothing or takes the
   * field strictly closer to one line.
   */
  useLayoutEffect(() => {
    setLift((current) => (current === null ? null : Math.min(current, ceiling())))
  }, [panelHeight, lift])

  /** Drag the grip to set the height yourself. Click it to hand it back. */
  const resize = (event: ReactPointerEvent): void => {
    const element = field.current
    if (!element) return
    let from = 0
    let started = 0
    let most = TALLEST
    trackPointer(event, {
      threshold: GRAB,
      onStart: (at) => {
        from = at.y
        started = element.getBoundingClientRect().height
        most = Math.min(TALLEST, ceiling())
      },
      // Up is taller, so the field grows towards the thread rather than off the
      // bottom of a window that cannot move.
      onMove: (at) => setLift(Math.min(Math.max(started + from - at.y, SHORTEST), most)),
      onTap: () => setLift(null)
    })
  }

  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    api.type(text)
    setDraft('')
  }

  return (
    <div className="composer">
      <div className="composer-field">
        <div
          className="grip"
          role="separator"
          title="Drag to resize. Click to reset."
          onPointerDown={resize}
        />
        <textarea
          ref={field}
          rows={1}
          value={draft}
          style={lift === null ? undefined : { height: lift }}
          spellCheck={false}
          placeholder={state.composer.mode === 'chat' ? 'Ask me anything' : state.composer.hint}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            send()
          }}
        />
      </div>
      <button className="send" aria-label="Send" disabled={draft.trim().length === 0} onClick={send}>
        <svg viewBox="0 0 16 16" aria-hidden>
          <path d="M8 13.5V3.2M8 3.2 3.8 7.4M8 3.2l4.2 4.2" />
        </svg>
      </button>
    </div>
  )
}

function Gear(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 fill-none stroke-current"
      style={{ color: 'var(--dim)' }}
      strokeWidth={1.35}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="2.5" />
      <path d="M6.8 1.5h2.4l.4 1.7a4.9 4.9 0 0 1 1.1.7l1.7-.6 1.7 1.7-.6 1.7c.3.3.5.7.7 1.1l1.7.4v2.4l-1.7.4a4.9 4.9 0 0 1-.7 1.1l.6 1.7-1.7 1.7-1.7-.6a4.9 4.9 0 0 1-1.1.7l-.4 1.7H6.8l-.4-1.7a4.9 4.9 0 0 1-1.1-.7l-1.7.6-1.7-1.7.6-1.7a4.9 4.9 0 0 1-.7-1.1L1.5 9.2V6.8l1.7-.4a4.9 4.9 0 0 1 .7-1.1l-.6-1.7 1.7-1.7 1.7.6c.3-.3.7-.5 1.1-.7l.4-1.7z" />
    </svg>
  )
}

function Cross(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-[13px] w-[13px] fill-none stroke-current" strokeWidth={1.45} strokeLinecap="round">
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  )
}

function Arrow(): ReactElement {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 fill-none stroke-current"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--faint)' }}
    >
      <path d="M2.5 8h11M9.5 4l4 4-4 4" />
    </svg>
  )
}
