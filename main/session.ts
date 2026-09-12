import { randomUUID } from 'node:crypto'
import { labelRoles } from '../shared/types.ts'
import type {
  Card,
  CompanionState,
  Concept,
  Evidence,
  Intent,
  Profile,
  Recap,
  RoleFamily,
  Suggestion,
  ThreadItem
} from '../shared/types.ts'
import type { LlmLike } from './llm/service.ts'
import type { Ikb } from './ikb/load.ts'
import { evidenceOf, profileRoles } from './ikb/search.ts'
import { computeGaps } from './ikb/gaps.ts'
import { extractConcepts } from './pipeline/extract.ts'
import { buildCard } from './pipeline/evidence.ts'
import { askCompanion } from './chat/companion.ts'
import { EMPTY_PROFILE, profileFromChat, summarise, withHeardTerms, withSignal } from './profile.ts'
import { Transcript } from './transcript.ts'
import { firstMatch } from './watch.ts'
import type { Mark, WorkEvent } from '../shared/leetcode.ts'
import { BETTER_QUESTION, LeetCodePractice } from './leetcode/practice.ts'
import { interviewAsk } from './interviews/ask.ts'
import { briefInterview } from './interviews/brief.ts'
import type { Account } from './interviews/sources.ts'

/** How fast the companion talks, and how long it pauses between turns. */
const WORD_MS = 26
const TURN_PAUSE = 420

export interface Emitter {
  patch(patch: Partial<CompanionState>): void
  add(item: ThreadItem): void
  token(id: string, token: string): void
  end(id: string, patch?: Partial<ThreadItem>): void
  card(card: Card): void
  recap(recap: Recap): void
}

export interface SessionDeps {
  llm: LlmLike
  ikb: Ikb
  emit: Emitter
  loadProfile(): Profile
  saveProfile(profile: Profile): void
  /** How fast the companion talks. Tests set both to zero. */
  pace?: { word: number; turn: number }
  /** A mark on the student's LeetCode editor, when a page is connected. */
  mark?(mark: Mark): void
  /** Every LeetCode event, written down so a session can be replayed. */
  record?(event: WorkEvent): Promise<void> | void
  /** Companies the base knows, so an ask about one of them is recognised. */
  companies?: readonly string[]
  /** First-hand interview accounts for a company. Absent in a checkout with no network. */
  gatherInterviews?(company: string): Promise<Account[]>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function nextId(): string {
  return randomUUID().slice(0, 8)
}

/** Keeps the spaces, so a streamed line reads the way it will finally look. */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean)
}

export class Session {
  readonly transcript = new Transcript()
  state: CompanionState = {
    orb: 'idle',
    expanded: false,
    thread: [],
    suggestions: [],
    whisper: null,
    composing: false,
    watching: [],
    composer: { mode: 'chat', hint: 'Ask me anything' },
    onboarded: false,
    modelConfigured: false
  }

  private readonly deps: SessionDeps
  private readonly cards = new Map<string, Card>()
  private readonly seen: { concept: Concept; terms: string[] }[] = []
  private profile: Profile = EMPTY_PROFILE
  private busy = false
  private readonly onboardingTurns: { role: string; text: string }[] = []

  private readonly pace: { word: number; turn: number }

  /** The second practice, beside the lecture. It speaks through the same thread. */
  readonly leetcode: LeetCodePractice

  constructor(deps: SessionDeps) {
    this.deps = deps
    this.pace = deps.pace ?? { word: WORD_MS, turn: TURN_PAUSE }
    this.profile = deps.loadProfile()
    this.state.onboarded = this.profile.major.length > 0 || this.profile.targetRoles.length > 0
    this.state.modelConfigured = deps.llm.available
    this.leetcode = new LeetCodePractice({
      llm: deps.llm,
      tier: () => this.profile.tier,
      record: deps.record,
      nextId,
      voice: {
        say: (text, extra) => this.say(text, extra),
        suggest: (suggestions) => this.suggest(suggestions),
        orb: (orb) => this.patch({ orb }),
        mark: (mark) => deps.mark?.(mark),
        focus: (problem) => this.focusProblem(problem)
      }
    })
  }

  /** A LeetCode problem in view takes the composer; leaving it hands it back. */
  private focusProblem(problem: string | null): void {
    if (problem) {
      this.patch({ composer: { mode: 'leetcode', hint: `Ask about ${problem}` } })
      return
    }
    if (this.state.composer.mode === 'leetcode') {
      this.patch({ composer: { mode: 'chat', hint: 'Ask me anything' } })
    }
  }

  /** What the page reported, or what the student asked of the practice. */
  observe(event: WorkEvent): Promise<void> {
    return this.leetcode.observe(event)
  }

  updateModelAvailable(available: boolean): void {
    this.patch({ modelConfigured: available })
  }

  // Speaking -------------------------------------------------------------

  private patch(patch: Partial<CompanionState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.emit.patch(patch)
  }

  private whisper(text: string): void {
    if (this.state.expanded) return
    this.patch({ whisper: { id: nextId(), text, at: Date.now() } })
  }

  /**
   * One line, word by word, with a pause before it starts. Everything the
   * companion says goes through here so the rhythm never changes.
   */
  private async say(
    text: string,
    extra: Omit<Partial<ThreadItem>, 'id' | 'text' | 'at'> = {},
    speaker: ThreadItem['speaker'] = 'companion'
  ): Promise<ThreadItem> {
    this.patch({ composing: true })
    await sleep(this.pace.turn)
    const item: ThreadItem = {
      id: nextId(),
      speaker,
      text: '',
      at: Date.now(),
      streaming: true,
      ...extra
    }
    this.deps.emit.add(item)
    this.patch({ composing: false })
    for (const word of words(text)) {
      this.deps.emit.token(item.id, word)
      await sleep(this.pace.word)
    }
    this.deps.emit.end(item.id)
    const done: ThreadItem = { ...item, text, streaming: false }
    this.state.thread.push(done)
    return done
  }

  /** The student's own line, which arrives whole. */
  private heardFromStudent(text: string): void {
    const item: ThreadItem = { id: nextId(), speaker: 'user', text, at: Date.now() }
    this.state.thread.push(item)
    this.deps.emit.add(item)
  }

  private suggest(suggestions: Suggestion[]): void {
    this.patch({ suggestions })
  }

  private async apologise(what: string, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error)
    await this.say(
      this.deps.llm.available
        ? `I could not ${what} just then. ${reason.slice(0, 120)}`
        : `I cannot ${what} until a model is configured. The job postings still work without one.`
    )
  }

  // Getting to know them -------------------------------------------------

  /** Two questions, then read the answers back for them to confirm. */
  async startOnboarding(): Promise<void> {
    if (this.state.onboarded || this.state.composer.mode === 'onboarding' || this.onboardingTurns.length > 0) return
    this.patch({
      composer: { mode: 'onboarding', hint: 'Tell me in your own words' }
    })
    await this.say('Before we start. What are you studying, and what kind of engineering are you after?')
  }

  private async onboardingTurn(text: string): Promise<void> {
    this.heardFromStudent(text)
    this.onboardingTurns.push({ role: 'student', text })

    if (this.onboardingTurns.length === 1) {
      const question = 'Got it. Anything you are actually into, inside class or outside it?'
      this.onboardingTurns.push({ role: 'companion', text: question })
      await this.say(question)
      return
    }

    this.patch({ orb: 'thinking' })
    try {
      this.profile = await profileFromChat(this.deps.llm, this.onboardingTurns, this.profile)
      this.deps.saveProfile(this.profile)
      await this.say(`So: ${summarise(this.profile)}. Have I got that right?`)
      this.suggest([
        { id: nextId(), text: 'That is right', intent: { kind: 'onboarded' } },
        { id: nextId(), text: 'Not quite', intent: { kind: 'reonboard' } }
      ])
    } catch {
      // Not knowing them is survivable. Getting stuck on the question is not.
      if (!this.deps.llm.available) {
        await this.say(
          'I could not note your goals because no model is configured. You can set one in Settings, but we can get going anyway.'
        )
      } else {
        await this.say('I did not catch all of that, but we can get going anyway.')
      }
      this.finishOnboarding()
    } finally {
      this.patch({ orb: 'idle' })
    }
  }

  private finishOnboarding(): void {
    this.onboardingTurns.length = 0
    this.patch({
      onboarded: true,
      composer: { mode: 'chat', hint: 'Ask me anything' }
    })
    this.deps.saveProfile(this.profile)
  }

  /** Something outside the conversation went wrong and the student should know. */
  async trouble(line: string): Promise<void> {
    await this.say(line)
  }

  // Reading a lecture ----------------------------------------------------

  /** A lecture arrives whole: uploaded from the tray, or pasted as notes. */
  async useNotes(text: string): Promise<void> {
    this.transcript.append(text)
    // The tap waits for the line where the lecturer says it, not for the words
    // scattered across a whole lecture.
    for (const line of text.split('\n')) {
      const hit = firstMatch(line, this.state.watching)
      if (hit) return this.lockIn(hit)
    }
    await this.why()
  }

  private async lockIn(concept: string): Promise<void> {
    this.patch({
      watching: this.state.watching.filter((watched) => watched !== concept),
      orb: 'alert'
    })
    this.whisper('This is it.')
    await this.say(`This lecture gets to ${concept}. Here is where it fits in at work.`)
    this.suggest([
      { id: nextId(), text: 'Why do I need this?', intent: { kind: 'why' } },
      { id: nextId(), text: 'Tell me more', intent: { kind: 'chat', text: `Tell me more about ${concept} at work` } }
    ])
  }

  // See ------------------------------------------------------------------

  private get roles(): RoleFamily[] {
    return profileRoles(this.profile)
  }

  /** The student asked, so extract from the window and say what it is worth. */
  async why(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.patch({ orb: 'thinking' })
      if (this.transcript.empty) {
        await this.say('Nothing has come through yet. Upload a lecture or paste your notes and I will read it back.')
        return
      }
      const [concept] = await extractConcepts(this.deps.llm, this.transcript.window())
      if (!concept) {
        await this.say('Nothing much is being taught in that. Try another part of the lecture.')
        return
      }
      await this.showCard(concept)
    } catch (error) {
      await this.apologise('read that back', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  private async showCard(concept: Concept): Promise<void> {
    const card = await buildCard(this.deps.llm, this.deps.ikb, concept, this.roles)
    this.cards.set(card.id, card)
    this.deps.emit.card(card)
    this.seen.push({ concept, terms: card.terms.map((term) => term.term) })

    this.profile = withHeardTerms(this.profile, card.terms.map((term) => term.term))
    this.deps.saveProfile(this.profile)

    const sentence = card.sentences[0]
    const evidence = sentence ? evidenceOf(this.deps.ikb, sentence) : undefined

    if (card.terms.length === 0) {
      await this.say(card.oneLiner)
      this.suggest([
        { id: nextId(), text: 'Show me something that is on there', intent: { kind: 'recap' } },
        { id: nextId(), text: 'Ask about it', intent: { kind: 'chat', text: '' } }
      ])
      return
    }

    const top = card.terms[0]!
    await this.say(card.oneLiner)
    await this.say(
      `They do not call it ${concept.name} though. On a posting it reads as ${top.term}, and ${top.hits} of the postings I have say something about it.`,
      evidence ? { evidence } : {}
    )

    this.suggest([
      { id: nextId(), text: 'Tell me more about this at work', intent: { kind: 'chat', text: `Tell me more about ${concept.name} at work` } },
      { id: nextId(), text: 'Sounds like me', intent: { kind: 'affinity', cardId: card.id } },
      { id: nextId(), text: 'Show me the gaps', intent: { kind: 'recap' } }
    ])
  }

  // Gaps and recap -------------------------------------------------------

  private latestCard(): Card | undefined {
    return [...this.cards.values()].at(-1)
  }

  async showRecap(): Promise<void> {
    const { gaps, cohort } = computeGaps(
      this.deps.ikb,
      this.roles,
      this.profile.heardTerms,
      3
    )
    const recap: Recap = { concepts: this.seen, gaps }
    this.deps.emit.recap(recap)

    if (this.seen.length > 0) {
      const names = this.seen.map((entry) => entry.concept.name).join(', ')
      await this.say(`Today you heard ${names}. All of it is on postings, under other names.`)
    }
    await this.say(
      `Here is what ${labelRoles(cohort.roles)} postings keep asking for that has not come up in your lectures.`
    )

    for (const gap of gaps) {
      const evidence = evidenceOf(this.deps.ikb, gap.exampleSentence)
      await this.say(
        `${gap.practice}, in ${gap.pctOfPostings} percent of them.`,
        evidence ? { evidence } : {}
      )
    }

    this.suggest([
      ...gaps.map((gap) => ({
        id: nextId(),
        text: `Tell me about ${gap.practice}`,
        intent: { kind: 'chat', text: `How is ${gap.practice} used at work?` } as Intent
      })),
      ...gaps.map((gap) => ({
        id: nextId(),
        text: `Nudge me when ${gap.practice} comes up in class`,
        intent: { kind: 'watch', concept: gap.practice } as Intent
      }))
    ])
  }

  // Chat -----------------------------------------------------------------

  /** Whatever the student typed, routed by what they are in the middle of. */
  async typed(text: string): Promise<void> {
    const { mode } = this.state.composer
    if (mode === 'onboarding') return this.onboardingTurn(text)
    if (mode === 'leetcode') {
      this.heardFromStudent(text)
      return this.observe({ kind: 'asked', at: Date.now(), text })
    }
    return this.chat(text)
  }

  async chat(text: string): Promise<void> {
    if (this.busy || !text.trim()) return
    const company = interviewAsk(text, this.deps.companies ?? [])
    if (company && this.deps.gatherInterviews) return this.interviews(company, text)
    this.busy = true
    try {
      this.heardFromStudent(text)
      this.patch({ orb: 'thinking' })
      await this.streamAnswer(async (onToken) => {
        const answer = await askCompanion(
          this.deps.llm,
          this.deps.ikb,
          {
            profile: this.profile,
            transcript: this.transcript.window(),
            card: this.latestCard() ?? null,
            history: this.state.thread.slice(-10).map((line) => ({ role: line.speaker, text: line.text }))
          },
          text,
          onToken
        )
        const sources = answer.sources
          .map((sentence) => evidenceOf(this.deps.ikb, sentence))
          .filter((found): found is NonNullable<typeof found> => found !== undefined)
        return { citations: answer.citations, sources }
      })
    } catch (error) {
      await this.apologise('answer that', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  /**
   * What people wrote about interviewing at a company, read from public
   * accounts and said with a citation on every claim. Nothing is said about
   * a company the sources have nothing recent on.
   */
  private async interviews(company: string, text: string): Promise<void> {
    this.busy = true
    try {
      this.heardFromStudent(text)
      this.patch({ orb: 'thinking' })
      await this.say(`Give me a moment. I am reading what people wrote about interviewing at ${company}.`)
      const accounts = await this.deps.gatherInterviews!(company)
      if (accounts.length === 0) {
        await this.say(
          `I found nothing first-hand about a ${company} interview from the last year on the boards I read. I would rather say that than make one up.`
        )
        return
      }
      await this.streamAnswer((onToken) => briefInterview(this.deps.llm, company, accounts, onToken))
    } catch (error) {
      await this.apologise('read up on that', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  /** One streamed line, with its citations riding out on the end of it. */
  private async streamAnswer(
    produce: (onToken: (token: string) => void) => Promise<{ citations: string[]; sources: Evidence[] }>
  ): Promise<void> {
    this.patch({ composing: true })
    await sleep(this.pace.turn)
    const item: ThreadItem = { id: nextId(), speaker: 'companion', text: '', at: Date.now(), streaming: true }
    this.deps.emit.add(item)
    this.patch({ composing: false })
    let full = ''
    const { citations, sources } = await produce((token) => {
      full += token
      this.deps.emit.token(item.id, token)
    })
    // The citations only exist once the stream is done, so they ride out with
    // the end of the line rather than getting lost behind it.
    this.deps.emit.end(item.id, { citations, sources })
    this.state.thread.push({ ...item, text: full, streaming: false, citations, sources })
  }

  // Wiring ---------------------------------------------------------------

  async run(intent: Intent): Promise<void> {
    switch (intent.kind) {
      case 'why':
        return this.why()
      case 'watch':
        this.patch({ watching: [...new Set([...this.state.watching, intent.concept])] })
        await this.say(`I will tap you when a lecture gets to ${intent.concept}.`)
        this.suggest([])
        return
      case 'recap':
        return this.showRecap()
      case 'affinity':
        return this.markAffinity(intent.cardId)
      case 'chat':
        return intent.text ? this.chat(intent.text) : undefined
      case 'onboarded':
        this.finishOnboarding()
        this.suggest([])
        await this.say('Good. Upload a lecture whenever, and I will tell you where it turns up.')
        return
      case 'profile': {
        const { courses, interests } = this.profile
        await this.say(`I have you down as ${summarise(this.profile)}.`)
        if (courses.length > 0 || interests.length > 0) {
          await this.say(
            [courses.length > 0 ? `Courses: ${courses.join(', ')}.` : '', interests.length > 0 ? `Into ${interests.join(', ')}.` : '']
              .filter(Boolean)
              .join(' ')
          )
        }
        this.suggest([
          { id: nextId(), text: 'Change that', intent: { kind: 'reonboard' } },
          { id: nextId(), text: 'That is fine', intent: { kind: 'chat', text: '' } }
        ])
        return
      }
      case 'hint':
        this.suggest([])
        return this.observe({ kind: 'help', at: Date.now() })
      case 'quiet':
        this.suggest([])
        return this.observe({ kind: 'quiet', at: Date.now() })
      case 'state':
        await this.say(this.leetcode.state())
        return
      case 'better':
        this.suggest([])
        this.heardFromStudent(BETTER_QUESTION)
        return this.observe({ kind: 'asked', at: Date.now(), text: BETTER_QUESTION })
      case 'reonboard':
        this.onboardingTurns.length = 0
        this.suggest([])
        this.patch({
          composer: { mode: 'onboarding', hint: 'Tell me in your own words' }
        })
        await this.say('Go on then, say it again and I will listen properly this time.')
        return
    }
  }

  private async markAffinity(cardId: string): Promise<void> {
    const card = this.cards.get(cardId)
    const sentence = card?.sentences[0]
    const posting = sentence ? this.deps.ikb.postings.get(sentence.postingId) : undefined
    const role = posting?.roleFamily ?? 'swe'
    this.profile = withSignal(this.profile, role)
    this.deps.saveProfile(this.profile)
    await this.say('Noted. I will lean that way when I pick what to show you.')
  }

  dismissWhisper(): void {
    if (this.state.whisper) this.patch({ whisper: null })
  }

  setExpanded(on: boolean): void {
    this.patch({ expanded: on, whisper: on ? null : this.state.whisper })
    if (on && this.state.orb === 'alert') this.patch({ orb: 'idle' })
  }

  getProfile(): Profile {
    return this.profile
  }

  updateProfile(patch: Partial<Profile>): void {
    const before = this.profile.tier
    this.profile = { ...this.profile, ...patch }
    this.deps.saveProfile(this.profile)
    this.patch({ onboarded: true })
    // The ceiling is an event like any other, so a recording carries it.
    if (patch.tier && patch.tier !== before) void this.observe({ kind: 'ceiling', at: Date.now(), tier: patch.tier })
  }

  /** Transcripts do not outlive the session that made them. */
  endSession(): void {
    this.transcript.clear()
  }
}
