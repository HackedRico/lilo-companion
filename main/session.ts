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
import { ASKS, BETTER_QUESTION, LeetCodePractice, TRACE_QUESTION } from './leetcode/practice.ts'
import { interviewAsk } from './interviews/ask.ts'
import { briefInterview, firstSentences } from './interviews/brief.ts'
import type { Account } from './interviews/sources.ts'
import { reasonFor } from './settings.ts'

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
  /** First-hand interview accounts for a company. Absent in a checkout with no network. */
  gatherInterviews?(company: string): Promise<Account[]>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** As much as fits beside the orb: the first sentence, or the first line of code. */
export function firstSentence(text: string, limit = 90): string {
  const prose = text.split('```')[0]?.trim() || text.trim()
  const end = prose.search(/[.!?](\s|$)/)
  const first = end > 0 ? prose.slice(0, end + 1) : prose
  return first.length > limit ? `${first.slice(0, limit - 1).trimEnd()}…` : first
}

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
  private readonly onboardingTurns: { role: string; text: string }[] = []

  private readonly pace: { word: number; turn: number }

  /** The second practice, beside the lecture. It speaks through the same thread. */
  readonly leetcode: LeetCodePractice
  private knownCompanies: string[] | null = null
  /** The turn on the wire, so a second question queues behind it rather than being dropped. */
  private working: Promise<unknown> | null = null

  constructor(deps: SessionDeps) {
    this.deps = deps
    this.pace = deps.pace ?? { word: WORD_MS, turn: TURN_PAUSE }
    this.profile = deps.loadProfile()
    this.state.onboarded =
      this.profile.onboarded === true || this.profile.major.length > 0 || this.profile.targetRoles.length > 0
    this.state.modelConfigured = deps.llm.available
    this.leetcode = new LeetCodePractice({
      llm: deps.llm,
      tier: () => this.profile.tier,
      record: deps.record,
      nextId,
      voice: {
        say: (text, extra) => this.saidWhileWorking(text, extra),
        suggest: (suggestions) => this.suggest(suggestions),
        // The dots are what says work is happening; the orb alone is easy to miss.
        orb: (orb) => this.patch({ orb, composing: orb === 'thinking' }),
        mark: (mark) => deps.mark?.(mark),
        focus: (problem) => this.focusProblem(problem)
      }
    })
  }

  /**
   * The student is in Chrome, so the panel is usually shut and the thread is
   * out of sight. Whatever the practice says still goes in the thread, and a
   * short form of it goes to the orb, or the companion would be talking to a
   * closed window while they work.
   */
  private async saidWhileWorking(
    text: string,
    extra?: Omit<Partial<ThreadItem>, 'id' | 'text' | 'at'>
  ): Promise<unknown> {
    this.whisper(firstSentence(text))
    return this.say(text, extra)
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
    speaker: ThreadItem['speaker'] = 'companion',
    /** False for a line that carries on the turn already in progress. */
    pause = true
  ): Promise<ThreadItem> {
    this.patch({ composing: true })
    if (pause) await sleep(this.pace.turn)
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
      // words() keeps the separators so the line reads as it will finally look.
      // Sleeping on those as well charged the pace twice per word.
      if (word.trim()) await sleep(this.pace.word)
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
    await this.say(
      this.deps.llm.available
        ? `I could not ${what} just then. ${reasonFor(error)}`
        : `I cannot ${what} until a model is configured. Open Settings and point me at one.`
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
    // Saved even when the model could not read the answers, so a student with
    // no model configured is not asked the same two questions at every launch.
    this.profile = { ...this.profile, onboarded: true }
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
    // Scanned slides and an empty file both read as nothing. Saying so beats
    // answering from the lecture before it, which is what happens if this falls
    // through to a transcript that is not empty.
    if (!text.trim()) {
      await this.say('There were no words in that one. If it is scanned slides or an image, I cannot read it yet.')
      return
    }
    this.transcript.append(text)
    // The tap waits for the line where the lecturer says it, not for the words
    // scattered across a whole lecture.
    for (const line of text.split('\n')) {
      const hit = firstMatch(line, this.state.watching)
      if (hit) return this.lockIn(hit)
    }
    // Reading a lecture is several seconds of model time, and an upload that
    // answers with nothing but dots reads as an upload that did not land. The
    // interview path says the same kind of thing for the same reason.
    await this.say('Reading it now.')
    this.patch({ orb: 'thinking', composing: true })
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

  /**
   * The student asked, so extract from the window and say what it is worth.
   * Queued rather than dropped: a second upload, or a second
   * press of the chip, waits for the first to finish and is then answered.
   */
  async why(): Promise<void> {
    return this.hold(async () => {
      try {
      this.patch({ orb: 'thinking', composing: true })
      if (this.transcript.empty) {
        await this.say('Nothing has come through yet. Upload a lecture or paste your notes and I will read it back.')
        return
      }
      const [concept] = await extractConcepts(this.deps.llm, this.transcript.window())
      if (!concept) {
        await this.say('There is not enough in that for me to work with. Send me more of it and I will read it back.')
        return
      }
        await this.showCard(concept)
      } catch (error) {
        await this.apologise('read that back', error)
      } finally {
        this.patch({ orb: 'idle', composing: false })
      }
    })
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
      `They do not call it ${concept.name} though. On a posting it reads as ${top.term}, and I have ${top.hits} ${top.hits === 1 ? 'posting' : 'postings'} that ask for it.`,
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
      // Not everything a lecture teaches is advertised for, and since a concept
      // with no surviving term is now said to be one, claiming all of it lands
      // on postings would be the one untrue line in the recap.
      const landed = this.seen.filter((entry) => entry.terms.length > 0)
      const verdict =
        landed.length === this.seen.length
          ? ' All of it is on postings, under other names.'
          : landed.length > 0
            ? ` ${landed.map((entry) => entry.concept.name).join(' and ')} is on postings, under other names.`
            : ''
      await this.say(`Today you heard ${names}.${verdict}`)
    }
    await this.say(
      `Here is what ${labelRoles(cohort.roles)} postings keep asking for that has not come up in your lectures.`
    )

    for (const gap of gaps) {
      const evidence = evidenceOf(this.deps.ikb, gap.exampleSentence)
      // One turn, three lines: the pause belongs before the turn, not before each.
      await this.say(`${gap.practice}, in ${gap.pctOfPostings} percent of them.`, evidence ? { evidence } : {}, 'companion', false)
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
    // A problem open in Chrome takes the composer, but asking what an interview
    // there is like is never a question about the code on screen.
    const aboutAnInterview = interviewAsk(text, this.companies) !== null
    if (mode === 'leetcode' && !aboutAnInterview) {
      this.heardFromStudent(text)
      return this.observe({ kind: 'asked', at: Date.now(), text })
    }
    return this.chat(text)
  }

  async chat(text: string): Promise<void> {
    if (!text.trim()) return
    const company = interviewAsk(text, this.companies)
    return this.turn(text, 'answer that', async () => {
      if (company && this.deps.gatherInterviews && (await this.interviews(company))) return
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
    })
  }

  /** The companies the base has postings for, which is what an interview ask is matched against. */
  private get companies(): string[] {
    this.knownCompanies ??= [...new Set([...this.deps.ikb.postings.values()].map((posting) => posting.company))]
    return this.knownCompanies
  }

  /**
   * One queue for everything that answers the student. Two answers writing into
   * the thread at once interleave their lines and fight over the orb, so the
   * second waits rather than racing, and nothing is dropped to avoid the race.
   */
  private hold<T>(work: () => Promise<T>): Promise<T> {
    const ahead = this.working ?? Promise.resolve()
    const run = ahead.catch(() => undefined).then(work)
    this.working = run.catch(() => undefined)
    return run
  }

  /**
   * One turn of the student's: what they said goes in the thread, the orb
   * thinks while the body runs, and a failure is apologised for in the words
   * of what was being attempted.
   */
  private async turn(text: string, attempting: string, body: () => Promise<void>): Promise<void> {
    // Said first, before any waiting: the composer has already cleared what they
    // typed, so a line that is not put in the thread now is a line they lose.
    this.heardFromStudent(text)
    return this.hold(async () => {
      try {
        this.patch({ orb: 'thinking', composing: true })
        await body()
      } catch (error) {
        await this.apologise(attempting, error)
      } finally {
        this.patch({ orb: 'idle', composing: false })
      }
    })
  }

  /**
   * What people wrote about interviewing at a company, read from public
   * accounts and said with a citation on every claim. Resolves false when
   * there was nothing to read, so the question still gets an ordinary answer.
   */
  private async interviews(company: string): Promise<boolean> {
    // The reading starts before the line about it is spoken, so the words cover the wait.
    const reading = this.deps.gatherInterviews!(company)
    await this.say(`Give me a moment. I am reading what people wrote about interviewing at ${company}.`)
    const accounts = await reading
    if (accounts.length === 0) {
      await this.say(
        `I found nothing first-hand about a ${company} interview on the boards I read, and I would rather say that than make one up.`
      )
      return false
    }
    // say() clears the dots when its line lands, and writing the brief is
    // several more seconds after that. Without this the panel sits still and
    // silent for the whole of it, which reads as the companion having stopped.
    this.patch({ composing: true })
    // Without a model the accounts are still worth handing over.
    const brief = this.deps.llm.available
      ? await briefInterview(this.deps.llm, company, accounts)
      : { kind: 'unwritable' as const, sources: firstSentences(accounts) }
    if (brief.kind === 'brief') {
      await this.say(brief.text, { citations: brief.citations, sources: brief.sources })
      return true
    }
    const count = `${accounts.length} account${accounts.length === 1 ? '' : 's'}`
    if (brief.sources.length === 0) {
      await this.say(`I read ${count}, but none had a sentence worth quoting back to you.`)
      return true
    }
    await this.say(
      this.deps.llm.available
        ? `I read ${count} and could not put them into words just now. Here is what I read.`
        : `I read ${count}. I cannot write them up until a model is configured, but here they are.`,
      { sources: brief.sources }
    )
    return true
  }

  /** One streamed line, with its citations riding out on the end of it. */
  private async streamAnswer(
    produce: (onToken: (token: string) => void) => Promise<{ citations: string[]; sources: Evidence[] }>
  ): Promise<void> {
    this.patch({ composing: true })
    await sleep(this.pace.turn)
    const item: ThreadItem = { id: nextId(), speaker: 'companion', text: '', at: Date.now(), streaming: true }
    this.deps.emit.add(item)
    let full = ''
    try {
      const { citations, sources } = await produce((token) => {
        // Not before: the dots are the only sign of life while the model thinks,
        // and an empty line with no dots reads as the companion having given up.
        if (!full) this.patch({ composing: false })
        full += token
        this.deps.emit.token(item.id, token)
      })
      // The citations only exist once the stream is done, so they ride out with
      // the end of the line rather than getting lost behind it.
      this.deps.emit.end(item.id, { citations, sources })
      this.state.thread.push({ ...item, text: full, streaming: false, citations, sources })
    } catch (error) {
      // A line that broke off mid-stream is still a line: closed as it stands,
      // so the caret stops and what was said survives a resync.
      this.deps.emit.end(item.id, { citations: [], sources: [] })
      this.state.thread.push({ ...item, text: full, streaming: false, citations: [], sources: [] })
      throw error
    }
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
      // A chip is the student asking, so the thread shows them asking it. Without
      // this the answer arrives with nothing above it saying what was asked.
      case 'hint':
        this.suggest([])
        this.heardFromStudent(ASKS.hint)
        return this.observe({ kind: 'help', at: Date.now() })
      case 'quiet':
        this.suggest([])
        this.heardFromStudent(ASKS.quiet)
        return this.observe({ kind: 'quiet', at: Date.now() })
      case 'state':
        this.heardFromStudent(ASKS.state)
        await this.say(this.leetcode.state())
        return
      case 'better':
        this.suggest([])
        this.heardFromStudent(ASKS.better)
        return this.observe({ kind: 'asked', at: Date.now(), text: BETTER_QUESTION })
      case 'trace':
        this.suggest([])
        this.heardFromStudent(ASKS.trace)
        return this.observe({ kind: 'asked', at: Date.now(), text: TRACE_QUESTION })
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
