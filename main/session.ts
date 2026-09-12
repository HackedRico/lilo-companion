import { randomUUID } from 'node:crypto'
import { labelRoles } from '../shared/types.ts'
import type {
  Card,
  CompanionState,
  Concept,
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
import { generateScenario } from './scenario/generate.ts'
import { ScenarioRun } from './scenario/stakeholder.ts'
import { reviewAnswer } from './scenario/review.ts'
import { askCompanion } from './chat/companion.ts'
import { EMPTY_PROFILE, profileFromChat, summarise, withHeardTerms, withSignal } from './profile.ts'
import { Transcript } from './transcript.ts'
import { firstMatch } from './watch.ts'

/** How fast the companion talks, and how long it pauses between turns. */
const WORD_MS = 26
const TURN_PAUSE = 420

/** The senior whose review the student gets. Fictional, and always the same. */
const REVIEWER = { name: 'Sam', role: 'senior engineer' }

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
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function nextId(): string {
  return randomUUID().slice(0, 8)
}

/** Keeps the spaces, so a streamed line reads the way it will finally look. */
function words(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean)
}

/** How long a ship-it is cheered before the face settles. */
const CHEER_MS = 2500

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
    activeScenarioId: null,
    composer: { mode: 'chat', hint: 'Ask me anything', who: null, scenarioId: null },
    onboarded: false
  }

  private readonly deps: SessionDeps
  private readonly cards = new Map<string, Card>()
  private readonly runs = new Map<string, ScenarioRun>()
  private readonly seen: { concept: Concept; terms: string[] }[] = []
  private profile: Profile = EMPTY_PROFILE
  private busy = false
  private readonly onboardingTurns: { role: string; text: string }[] = []

  private readonly pace: { word: number; turn: number }

  constructor(deps: SessionDeps) {
    this.deps = deps
    this.pace = deps.pace ?? { word: WORD_MS, turn: TURN_PAUSE }
    this.profile = deps.loadProfile()
    this.state.onboarded = this.profile.major.length > 0 || this.profile.targetRoles.length > 0
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
    if (this.state.onboarded) return
    this.patch({
      composer: { mode: 'onboarding', hint: 'Tell me in your own words', who: null, scenarioId: null }
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
      await this.say('I did not catch all of that, but we can get going anyway.')
      this.finishOnboarding()
    } finally {
      this.patch({ orb: 'idle' })
    }
  }

  private finishOnboarding(): void {
    this.onboardingTurns.length = 0
    this.patch({
      onboarded: true,
      composer: { mode: 'chat', hint: 'Ask me anything', who: null, scenarioId: null }
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
    const waiting = [...this.runs.values()].find((run) => run.submitted !== null)
    await this.say(`This lecture gets to ${concept}. This is the piece you were missing.`)
    this.suggest([
      ...(waiting
        ? [
            {
              id: nextId(),
              text: `Let me answer ${waiting.scenario.from.name} again`,
              intent: { kind: 'reopen', scenarioId: waiting.scenario.id } as Intent
            }
          ]
        : []),
      { id: nextId(), text: 'Why do I need this?', intent: { kind: 'why' } }
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
      { id: nextId(), text: 'Try it like work', intent: { kind: 'scenario', cardId: card.id } },
      { id: nextId(), text: 'Sounds like me', intent: { kind: 'affinity', cardId: card.id } },
      { id: nextId(), text: 'Go on then', intent: { kind: 'chat', text: `Tell me more about ${concept.name} at work` } }
    ])
  }

  // Do -------------------------------------------------------------------

  async startScenario(cardId?: string, gapPractice?: string): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      this.patch({ orb: 'thinking' })
      const card = cardId ? this.cards.get(cardId) : this.latestCard()
      const source = card ?? (gapPractice ? await this.cardForGap(gapPractice) : undefined)
      if (!source || source.sentences.length === 0) {
        await this.say('I need something with real postings behind it before I can hand you work.')
        return
      }
      // Writing the request is the longest wait in the whole loop, so the
      // student gets told it is happening rather than watching a pulsing orb.
      await this.say('Give me a second, I am writing this up the way it would actually arrive.')
      this.patch({ composing: true })
      const scenario = await generateScenario(this.deps.llm, this.deps.ikb, source, this.profile)
      this.patch({ composing: false })
      const run = new ScenarioRun(scenario)
      this.runs.set(scenario.id, run)
      this.patch({
        activeScenarioId: scenario.id,
        composer: {
          mode: 'ask',
          hint: `Ask ${scenario.from.name} something`,
          who: scenario.from.name,
          scenarioId: scenario.id
        }
      })

      const posting = this.deps.ikb.postings.get(
        this.deps.ikb.sentences.find((s) => s.id === scenario.citedSentenceId)?.postingId ?? ''
      )
      await this.say(
        `${scenario.from.name}, ${scenario.from.role}, just sent you this. Inspired by a real ${posting?.company ?? 'company'} posting.`
      )
      await this.say(
        scenario.visibleMessage,
        {
          from: scenario.from,
          ...(scenario.attachment.type === 'none' ? {} : { attachment: scenario.attachment })
        },
        'stakeholder'
      )
      await this.say(
        'She left out half of what you need. That is not her being careless, that is just how requests arrive. Ask her something before you answer.'
      )
      this.suggestScenarioQuestions(scenario.id)
    } catch (error) {
      await this.apologise('write that up as work', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  private suggestScenarioQuestions(scenarioId: string): void {
    this.suggest([
      {
        id: nextId(),
        text: 'Anything unusual about that period?',
        intent: { kind: 'ask', scenarioId, question: 'Was there anything unusual going on during that period?' }
      },
      {
        id: nextId(),
        text: 'Who is this actually for?',
        intent: { kind: 'ask', scenarioId, question: 'Who is going to read this, and what do they need to decide?' }
      },
      { id: nextId(), text: 'I am ready to answer', intent: { kind: 'submit', scenarioId } }
    ])
  }

  async askStakeholder(scenarioId: string, question: string): Promise<void> {
    const run = this.runs.get(scenarioId)
    if (!run || this.busy) return
    this.busy = true
    try {
      this.heardFromStudent(question)
      this.patch({ orb: 'thinking' })
      const { reply, uncovered } = await run.ask(this.deps.llm, question)
      await this.say(reply, { from: run.scenario.from }, 'stakeholder')
      if (uncovered.length > 0) {
        await this.say('That changes things. Worth knowing before you answer.')
      }
      this.suggestScenarioQuestions(scenarioId)
    } catch (error) {
      await this.apologise('get an answer out of her', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  async submitScenario(scenarioId: string, reply: string): Promise<void> {
    const run = this.runs.get(scenarioId)
    if (!run || this.busy) return
    this.busy = true
    let cheer = false
    try {
      this.heardFromStudent(reply)
      this.patch({ orb: 'thinking' })
      await this.say(`${REVIEWER.name} had a look.`)
      const review = await reviewAnswer(this.deps.llm, run, reply)
      const prior = run.submitted
      run.submitted = reply
      cheer = review.verdict === 'ship_it'

      const verdict = review.verdict === 'ship_it' ? 'Ship it.' : 'Not yet.'
      const mark = { from: REVIEWER, verdict: review.verdict }
      await this.say(
        `${verdict} ${review.strengths[0] ?? ''}`.trim(),
        { ...mark, ...(prior ? { priorAnswer: { text: prior, at: Date.now() } } : {}) },
        'reviewer'
      )
      if (review.gaps[0]) await this.say(review.gaps[0], mark, 'reviewer')
      await this.say(review.seniorQuestion, mark, 'reviewer')

      this.patch({
        composer: { mode: 'chat', hint: 'Ask me anything', who: null, scenarioId: null },
        activeScenarioId: null
      })
      const topic = review.missedTopics[0]
      if (review.verdict === 'needs_changes' && topic) {
        await this.say(`You have not been taught ${topic} yet. It is coming.`)
        this.suggest([
          { id: nextId(), text: 'Nudge me when it comes up', intent: { kind: 'watch', concept: topic } },
          { id: nextId(), text: 'Let me try again now', intent: { kind: 'reopen', scenarioId } }
        ])
        return
      }
      this.suggest([
        { id: nextId(), text: "Show me what class won't teach me", intent: { kind: 'recap' } },
        { id: nextId(), text: 'Back to the lecture', intent: { kind: 'chat', text: '' } }
      ])
    } catch (error) {
      await this.apologise('get that reviewed', error)
    } finally {
      this.busy = false
      // A ship-it is the one thing worth a hop. It settles on its own, unless
      // something else has already moved the face on.
      this.patch({ orb: cheer ? 'cheering' : 'idle' })
      if (cheer) {
        setTimeout(() => {
          if (this.state.orb === 'cheering') this.patch({ orb: 'idle' })
        }, CHEER_MS).unref()
      }
    }
  }

  async reopen(scenarioId: string): Promise<void> {
    const run = this.runs.get(scenarioId)
    if (!run) return
    run.priorAnswer = run.submitted ? { text: run.submitted, at: Date.now() } : null
    this.patch({
      activeScenarioId: scenarioId,
      composer: {
        mode: 'ask',
        hint: `Ask ${run.scenario.from.name} something`,
        who: run.scenario.from.name,
        scenarioId
      }
    })
    await this.say(`Here is what ${run.scenario.from.name} asked, again.`)
    await this.say(run.scenario.visibleMessage, { from: run.scenario.from }, 'stakeholder')
    if (run.priorAnswer) {
      await this.say('This is what you told her last time. Have another go.', {
        priorAnswer: run.priorAnswer
      })
    }
    this.suggestScenarioQuestions(scenarioId)
  }

  // Gaps and recap -------------------------------------------------------

  private latestCard(): Card | undefined {
    return [...this.cards.values()].at(-1)
  }

  private async cardForGap(practice: string): Promise<Card | undefined> {
    const sentences = this.deps.ikb.byTag.get(practice) ?? []
    const sentence = sentences[0]
    if (!sentence) return undefined
    return {
      id: `card_gap_${nextId()}`,
      concept: { name: practice, summary: `An industry practice: ${practice}`, confidence: 'high' },
      terms: [{ term: practice, hits: sentences.length }],
      sentences: sentences.slice(0, 3),
      oneLiner: `${practice} is asked for constantly and taught almost nowhere.`
    }
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

    this.suggest(
      gaps.map((gap) => ({
        id: nextId(),
        text: `Try ${gap.practice} like work`,
        intent: { kind: 'scenario', gap: gap.practice } as Intent
      }))
    )
  }

  // Chat -----------------------------------------------------------------

  /** Whatever the student typed, routed by what they are in the middle of. */
  async typed(text: string): Promise<void> {
    const { mode, scenarioId } = this.state.composer
    if (mode === 'onboarding') return this.onboardingTurn(text)
    if (mode === 'ask' && scenarioId) return this.askStakeholder(scenarioId, text)
    if (mode === 'reply' && scenarioId) return this.submitScenario(scenarioId, text)
    return this.chat(text)
  }

  async chat(text: string): Promise<void> {
    if (this.busy || !text.trim()) return
    this.busy = true
    try {
      this.heardFromStudent(text)
      this.patch({ orb: 'thinking', composing: true })
      await sleep(this.pace.turn)
      const item: ThreadItem = {
        id: nextId(),
        speaker: 'companion',
        text: '',
        at: Date.now(),
        streaming: true
      }
      this.deps.emit.add(item)
      this.patch({ composing: false })
      let full = ''
      const answer = await askCompanion(
        this.deps.llm,
        this.deps.ikb,
        {
          profile: this.profile,
          transcript: this.transcript.window(),
          card: this.latestCard() ?? null,
          history: this.state.thread.slice(-10).map((line) => ({ role: line.speaker, text: line.text })),
          inScenario: this.state.activeScenarioId !== null
        },
        text,
        (token) => {
          full += token
          this.deps.emit.token(item.id, token)
        }
      )
      const sources = answer.sources
        .map((sentence) => evidenceOf(this.deps.ikb, sentence))
        .filter((found): found is NonNullable<typeof found> => found !== undefined)
      // The citations only exist once the stream is done, so they ride out with
      // the end of the line rather than getting lost behind it.
      this.deps.emit.end(item.id, { citations: answer.citations, sources })
      const done: ThreadItem = {
        ...item,
        text: full,
        streaming: false,
        citations: answer.citations,
        sources
      }
      this.state.thread.push(done)
    } catch (error) {
      await this.apologise('answer that', error)
    } finally {
      this.busy = false
      this.patch({ orb: 'idle' })
    }
  }

  // Wiring ---------------------------------------------------------------

  async run(intent: Intent): Promise<void> {
    switch (intent.kind) {
      case 'why':
        return this.why()
      case 'scenario':
        return this.startScenario(intent.cardId, intent.gap)
      case 'ask':
        return this.askStakeholder(intent.scenarioId, intent.question)
      case 'submit': {
        const run = this.runs.get(intent.scenarioId)
        this.suggest([])
        this.patch({
          composer: {
            mode: 'reply',
            hint: `Write your reply to ${run?.scenario.from.name ?? 'them'}`,
            who: run?.scenario.from.name ?? 'them',
            scenarioId: intent.scenarioId
          }
        })
        await this.say(
          `Go on then, write ${run?.scenario.from.name ?? 'them'} the reply. ${REVIEWER.name} will look it over.`
        )
        return
      }
      case 'revise':
      case 'reopen':
        return this.reopen(intent.scenarioId)
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
      case 'reonboard':
        this.onboardingTurns.length = 0
        this.suggest([])
        this.patch({
          composer: { mode: 'onboarding', hint: 'Tell me in your own words', who: null, scenarioId: null }
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
    this.profile = { ...this.profile, ...patch }
    this.deps.saveProfile(this.profile)
    this.patch({ onboarded: true })
  }

  /** Transcripts do not outlive the session that made them. */
  endSession(): void {
    this.transcript.clear()
  }
}
