import { TIER_CEILING, TIER_LABEL, type Mark, type Problem, type Rung, type Tier, type Trace, type WorkEvent } from '../../shared/leetcode.ts'
import type { OrbState, Suggestion, ThreadItem } from '../../shared/types.ts'
import type { LlmLike } from '../llm/service.ts'
import { coach } from './coach.ts'
import { CLIMB_EVERY, nextRung, type Climb } from './ladder.ts'
import { EMPTY_WORK, describe, describeOutcome, fold, type Work } from './state.ts'

/** How the practice reaches the student. The session provides it. */
export interface Voice {
  say(text: string, extra?: Omit<Partial<ThreadItem>, 'id' | 'text' | 'at'>): Promise<unknown>
  suggest(suggestions: Suggestion[]): void
  orb(state: OrbState): void
  /** The one channel back to the page: mark lines, marked as the companion's. */
  mark(mark: Mark): void
  /** A problem came into or went out of view, so the composer follows it. */
  focus(problem: string | null): void
}

export interface PracticeDeps {
  llm: LlmLike
  voice: Voice
  tier(): Tier
  record?(event: WorkEvent): Promise<void> | void
  now?(): number
  nextId(): string
}

/** What the student is asking for when they press the button rather than typing. */
export const HELP_QUESTION = 'Give me a hint.'
export const BETTER_QUESTION = 'It passes now. Is there a better approach, and why?'
export const TRACE_QUESTION = 'Walk me through it step by step.'

/** What a chip says, which is also what goes in the thread when it is pressed. */
export const ASKS = {
  hint: 'Give me a hint',
  state: 'How am I doing?',
  quiet: 'Quiet for a bit',
  better: 'Is there a better way?',
  trace: 'Walk me through it'
} as const

/**
 * The LeetCode practice: folds what the page reports, says the state in words
 * that need no model, and climbs the ladder on effort. Every hint goes
 * through the coach and its gate; nothing here ever writes to the page beyond
 * a mark on a line.
 */
export class LeetCodePractice {
  work: Work = EMPTY_WORK
  private last: Climb | null = null
  private busy = false
  /** What is on the wire. A question waits for it; a volunteered hint stands down. */
  private inFlight: Promise<unknown> | null = null
  /**
   * When the timer may try again after a pass that failed. Without it a dead
   * endpoint is asked on every tick, and the tick is two seconds. The rung is
   * not charged for a network failure, so this is what stops the hammering.
   */
  private retryAfter = 0
  private readonly deps: PracticeDeps

  constructor(deps: PracticeDeps) {
    this.deps = deps
  }

  get open(): boolean {
    return this.work.problem !== null
  }

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** The state read back, the same at every tier. */
  state(): string {
    return describe(this.work, this.now)
  }

  /** How long the page is given to report what is already in the editor. */
  private static readonly SETTLE_MS = 4000

  /**
   * The state once the page has said what is in the editor. What is waited for
   * is the report, not code in it, because an empty editor is an answer too and
   * waiting for code would hold the greeting the full four seconds every time a
   * student opens a problem they have not started.
   */
  private async settle(): Promise<string> {
    const problem = this.work.problem
    for (let waited = 0; waited < LeetCodePractice.SETTLE_MS; waited += 200) {
      if (this.work.changedAt !== null) break
      await new Promise((resolve) => setTimeout(resolve, 200))
      // They moved on while we waited, so the line would be about the wrong thing.
      if (this.work.problem !== problem) break
    }
    return this.state()
  }

  async observe(event: WorkEvent): Promise<void> {
    await this.deps.record?.(event)
    const before = this.work
    this.work = fold(this.work, event)
    const { voice } = this.deps
    switch (event.kind) {
      case 'opened': {
        // The page is asked to say again what is open every time the app
        // reconnects, so hearing about the problem already in hand is a
        // repeat. Greeting it again would make a reconnection read as a new
        // problem, and would send the ladder back to the bottom.
        if (before.problem?.slug === event.problem.slug) return
        this.last = null
        voice.focus(event.problem.title)
        // The editor's contents arrive a moment after the page says which problem
        // it is, so what is already written is waited for rather than denied.
        const settled = await this.settle()
        await voice.say(`${settled} You have me on ${TIER_LABEL[this.deps.tier()]}.`)
        this.offer()
        return
      }
      case 'closed':
        this.last = null
        voice.focus(null)
        voice.suggest([])
        return
      case 'outcome':
        if (event.outcome.verdict === 'accepted') {
          voice.orb('cheering')
          await voice.say('Accepted. That one is yours.')
          this.deps.voice.suggest([
            {
              id: this.deps.nextId(),
              text: 'Where does this turn up at work?',
              intent: { kind: 'chat', text: `Where does ${this.work.problem?.title ?? 'this problem'} turn up in real work?` }
            },
            { id: this.deps.nextId(), text: ASKS.better, intent: { kind: 'better' } }
          ])
          return
        }
        // The floor: the verdict read back plainly, no advice on top of it.
        await voice.say(describeOutcome(event.outcome))
        this.offer()
        return
      case 'asked':
        return this.answer(event.text)
      case 'help':
        return this.answer(HELP_QUESTION)
      case 'quiet':
        await voice.say('Quiet for ten minutes. Say the word if you want me sooner.')
        return
      case 'ceiling':
        await voice.say(`On ${TIER_LABEL[event.tier]} now.`)
        return
      case 'changed':
      case 'pending':
      case 'attention':
        return
    }
  }

  /**
   * The proactive side. Called on a timer; says nothing unless the ladder
   * says a rung is earned, and then only one rung above the last.
   */
  async tick(now = this.now): Promise<void> {
    if (this.busy || !this.deps.llm.available || now < this.retryAfter) return
    const rung = nextRung(TIER_CEILING[this.deps.tier()].volunteer, this.last, this.work, now)
    if (rung === null) return
    this.busy = true
    const asked = this.work.problem
    try {
      const result = await coach(this.deps.llm, this.work, rung, null, now)
      if (!this.stillOn(asked)) return
      // Counted as a climb even when nothing was said, so silence is not retried every tick.
      this.last = { rung, at: now, codeAt: this.work.changedAt }
      if (result.kind === 'hint') await this.speak(result.hint)
      if (result.kind === 'withheld') await this.deps.voice.say(result.say)
    } catch {
      // A hint that fails to arrive is a hint not given, which is allowed. The
      // ladder is not charged for it, so the wait is what stops the next tick
      // asking the same failing endpoint two seconds later.
      this.retryAfter = now + CLIMB_EVERY
    } finally {
      this.busy = false
    }
  }

  private async answer(question: string): Promise<void> {
    const { voice } = this.deps
    if (!this.open) {
      await voice.say('Nothing open on LeetCode.')
      return
    }
    // Never dropped. Whatever the timer has on the wire is already paid for, so
    // the question waits it out rather than vanishing after the student has
    // watched their own words go into the thread.
    const ahead = this.inFlight
    if (ahead) await ahead.catch(() => undefined)
    const run = this.ask(question)
    this.inFlight = run.catch(() => undefined)
    return run
  }

  private async ask(question: string): Promise<void> {
    const { voice } = this.deps
    this.busy = true
    const asked = this.work.problem
    voice.orb('thinking')
    try {
      const ceiling = TIER_CEILING[this.deps.tier()].onAsk
      const result = await coach(this.deps.llm, this.work, ceiling, question, this.now)
      if (!this.stillOn(asked)) return
      if (result.kind === 'hint') {
        // The timer waits for another edit rather than piling on what was just
        // answered. The rung it would volunteer is left alone: what they asked
        // for is theirs, and the ladder still climbs from where it had got to.
        this.last = { rung: this.last?.rung ?? 0, at: this.now, codeAt: this.work.changedAt }
        await this.speak(result.hint)
      }
      if (result.kind === 'withheld') await voice.say(result.say)
      if (result.kind === 'silent') await voice.say('I have nothing specific enough to say about that yet.')
      this.offer()
    } catch (error) {
      if (!this.deps.llm.available) {
        await voice.say('I cannot coach you until a model is configured. Open Settings to set your model.')
      } else {
        const reason = error instanceof Error ? error.message : String(error)
        await voice.say(`I could not get a thought together just then. ${reason.slice(0, 120)}`)
      }
    } finally {
      this.busy = false
      voice.orb('idle')
    }
  }

  /**
   * Whether the problem an answer was asked about is still the one on the page.
   * A model call takes seconds, and the student can close the tab or move to
   * the next problem inside them. A hint about code that is gone, and a mark on
   * lines that are gone, are worse than saying nothing.
   */
  private stillOn(problem: Problem | null): boolean {
    return problem !== null && this.work.problem?.slug === problem.slug
  }

  /** The words, the rung they reached, and the picture when there is one; then the mark. */
  private async speak(hint: { say: string; rung: Rung; lines: number[]; trace?: Trace }): Promise<void> {
    await this.deps.voice.say(hint.say, hint.trace ? { rung: hint.rung, trace: hint.trace } : { rung: hint.rung })
    if (hint.lines.length > 0) this.deps.voice.mark({ lines: hint.lines })
  }

  private offer(): void {
    const id = this.deps.nextId
    // A picture of the idea is the idea drawn, which hands off may not give.
    const walk: Suggestion[] =
      this.deps.tier() === 'hands_off' ? [] : [{ id: id(), text: ASKS.trace, intent: { kind: 'trace' } }]
    this.deps.voice.suggest([
      { id: id(), text: ASKS.hint, intent: { kind: 'hint' } },
      ...walk,
      { id: id(), text: ASKS.state, intent: { kind: 'state' } },
      { id: id(), text: ASKS.quiet, intent: { kind: 'quiet' } }
    ])
  }
}
