import { TIER_CEILING, TIER_LABEL, type Mark, type Rung, type Tier, type WorkEvent } from '../../shared/leetcode.ts'
import type { OrbState, Suggestion, ThreadItem } from '../../shared/types.ts'
import type { LlmLike } from '../llm/service.ts'
import { coach } from './coach.ts'
import { nextRung, type Climb } from './ladder.ts'
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
  private static readonly SETTLE_MS = 2000

  /** The state once the code that was already there has had time to arrive. */
  private async settle(): Promise<string> {
    const problem = this.work.problem
    for (let waited = 0; waited < LeetCodePractice.SETTLE_MS; waited += 250) {
      if (this.work.code) break
      await new Promise((resolve) => setTimeout(resolve, 250))
      // They moved on while we waited, so the line would be about the wrong thing.
      if (this.work.problem !== problem) break
    }
    return this.state()
  }

  async observe(event: WorkEvent): Promise<void> {
    await this.deps.record?.(event)
    this.work = fold(this.work, event)
    const { voice } = this.deps
    switch (event.kind) {
      case 'opened': {
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
            { id: this.deps.nextId(), text: 'Is there a better way?', intent: { kind: 'better' } }
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
    if (this.busy || !this.deps.llm.available) return
    const rung = nextRung(TIER_CEILING[this.deps.tier()].volunteer, this.last, this.work, now)
    if (rung === null) return
    this.busy = true
    try {
      const result = await coach(this.deps.llm, this.work, rung, null, now)
      // Counted as a climb even when nothing was said, so silence is not retried every tick.
      this.last = { rung, at: now, codeAt: this.work.changedAt }
      if (result.kind === 'hint') await this.speak(result.hint.say, result.hint.rung, result.hint.lines)
      if (result.kind === 'withheld') await this.deps.voice.say(result.say)
    } catch {
      // A hint that fails to arrive is a hint not given, which is allowed.
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
    if (this.busy) return
    this.busy = true
    voice.orb('thinking')
    try {
      const ceiling = TIER_CEILING[this.deps.tier()].onAsk
      const result = await coach(this.deps.llm, this.work, ceiling, question, this.now)
      if (result.kind === 'hint') {
        // The timer waits for another edit rather than piling on what was just
        // answered. The rung it would volunteer is left alone: what they asked
        // for is theirs, and the ladder still climbs from where it had got to.
        this.last = { rung: this.last?.rung ?? 0, at: this.now, codeAt: this.work.changedAt }
        await this.speak(result.hint.say, result.hint.rung, result.hint.lines)
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

  private async speak(say: string, rung: Rung, lines: number[]): Promise<void> {
    await this.deps.voice.say(say, { rung })
    if (lines.length > 0) this.deps.voice.mark({ lines })
  }

  private offer(): void {
    const id = this.deps.nextId
    this.deps.voice.suggest([
      { id: id(), text: 'Give me a hint', intent: { kind: 'hint' } },
      { id: id(), text: 'How am I doing?', intent: { kind: 'state' } },
      { id: id(), text: 'Quiet for a bit', intent: { kind: 'quiet' } }
    ])
  }
}
