import type { Rung, Tier } from './leetcode.ts'

// Domain -----------------------------------------------------------------

/**
 * The tracks a software engineering posting can be on. `swe` is a posting that
 * named no track, and a student who aims at `swe` is aiming at every track.
 * Nothing outside software engineering is in the base, so there is no `other`.
 */
export const ROLE_FAMILIES = [
  'swe',
  'backend',
  'frontend',
  'fullstack',
  'mobile',
  'infra',
  'security',
  'ml'
] as const

export type RoleFamily = (typeof ROLE_FAMILIES)[number]

/** Whether a posting on `family` is one the student's aims take in. */
export function wantsFamily(wanted: readonly RoleFamily[], family: RoleFamily): boolean {
  return wanted.length === 0 || wanted.includes('swe') || wanted.includes(family)
}

export type Seniority = 'intern' | 'new_grad' | 'junior' | 'mid' | 'senior'

/** What a student says they are after, and what the postings made of it. */
export interface Aim {
  /** What they typed. */
  said: string
  /** The family their postings sit under, or null when there are none. */
  family: RoleFamily | null
  /** How many postings answered to it, so thin ground can be admitted. */
  matches: number
}

export interface Posting {
  id: string
  company: string
  title: string
  roleFamily: RoleFamily
  seniority: Seniority
  url: string
}

/** One sentence lifted from a posting, tagged with the tools and practices in it. */
export interface Sentence {
  id: string
  postingId: string
  text: string
  tags: string[]
}

export interface Concept {
  name: string
  summary: string
  confidence: 'low' | 'medium' | 'high'
}

export interface Card {
  id: string
  concept: Concept
  terms: { term: string; hits: number }[]
  sentences: Sentence[]
  oneLiner: string
}

export interface HiddenFact {
  id: string
  fact: string
  revealWhen: string
}

export interface Scenario {
  id: string
  title: string
  format: 'jira' | 'slack' | 'email'
  from: { name: string; role: string }
  persona: string
  visibleMessage: string
  attachment: { type: 'table' | 'code' | 'none'; content: string }
  /** Never sent to the renderer, and never sent to the persona until uncovered. */
  hiddenFacts: HiddenFact[]
  deliverable: string
  classVersion: string
  /** Never sent to the renderer. Written before the student answers. */
  rubric: string[]
  citedSentenceId: string
}

/** What the renderer is allowed to know about a scenario. */

export interface Review {
  verdict: 'ship_it' | 'needs_changes'
  strengths: string[]
  gaps: string[]
  missedTopics: string[]
  seniorQuestion: string
}

export interface Gap {
  practice: string
  pctOfPostings: number
  exampleSentence: Sentence
}

export interface ChatMessage {
  id: string
  thread: 'companion' | string
  role: 'user' | 'assistant' | 'stakeholder'
  text: string
  citations: string[]
}

export interface Profile {
  major: string
  year: string
  courses: string[]
  /** What the student says they are after, in their own words. */
  aims: string[]
  /**
   * Which posting families those words actually land in. Derived from `aims`,
   * never typed: evidence and gap statistics filter on this, and every posting
   * carries exactly one of them.
   */
  targetRoles: RoleFamily[]
  interests: string[]
  roleAffinity: Record<string, number>
  heardTerms: string[]
  /** How much help the companion may give on LeetCode. The student picks it. */
  tier: Tier
}

export interface Recap {
  concepts: { concept: Concept; terms: string[] }[]
  gaps: Gap[]
}

// The thread -------------------------------------------------------------

export type Speaker = 'companion' | 'user' | 'stakeholder' | 'reviewer'

/** Evidence rides along with a line. It is never rendered as a labelled field. */
export interface Evidence {
  sentence: Sentence
  company: string
  title: string
  url: string
}

export interface ThreadItem {
  id: string
  speaker: Speaker
  text: string
  at: number
  streaming?: boolean
  /** Set when the speaker is a person, so the thread can attribute the line. */
  from?: { name: string; role: string }
  /** Set on a review, so the thread can show which way it went. */
  verdict?: Review['verdict']
  evidence?: Evidence
  attachment?: { type: 'table' | 'code' | 'none'; content: string }
  citations?: string[]
  /** Resolved citations, rendered as chips under a chat answer. */
  sources?: Evidence[]
  /** An earlier answer shown beside a new one, after a lock-in. */
  priorAnswer?: { text: string; at: number }
  /** Set on a LeetCode hint, so the thread can say how much it gave away. */
  rung?: Rung
}

export type Intent =
  | { kind: 'why' }
  | { kind: 'scenario'; cardId?: string; gap?: string }
  | { kind: 'ask'; scenarioId: string; question: string }
  | { kind: 'submit'; scenarioId: string }
  | { kind: 'revise'; scenarioId: string }
  | { kind: 'watch'; concept: string }
  | { kind: 'reopen'; scenarioId: string }
  | { kind: 'chat'; text: string }
  | { kind: 'recap' }
  | { kind: 'affinity'; cardId: string }
  | { kind: 'onboarded' }
  | { kind: 'reonboard' }
  | { kind: 'profile' }
  | { kind: 'hint' }
  | { kind: 'quiet' }
  | { kind: 'state' }
  | { kind: 'better' }

/** Phrased the way the student would say it, never as a feature name. */
export interface Suggestion {
  id: string
  text: string
  intent: Intent
}

export interface Whisper {
  id: string
  text: string
  at: number
}

/** The orb's whole vocabulary. */
export type OrbState = 'idle' | 'thinking' | 'alert' | 'cheering'

/**
 * Where what the student types goes next. A question during a scenario reaches
 * the coworker; the answer itself only goes in once they say they are ready.
 */
export interface ComposerMode {
  mode: 'chat' | 'ask' | 'reply' | 'onboarding' | 'leetcode'
  hint: string
  /** Who is being written to, named rather than parsed back out of the hint. */
  who: string | null
  scenarioId: string | null
}

export interface CompanionState {
  orb: OrbState
  expanded: boolean
  thread: ThreadItem[]
  suggestions: Suggestion[]
  whisper: Whisper | null
  composing: boolean
  /** Concepts the student asked to be tapped on when class reaches them. */
  watching: string[]
  activeScenarioId: string | null
  composer: ComposerMode
  onboarded: boolean
}

// The window -------------------------------------------------------------

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

export type Side = 'left' | 'right'
export type Edge = 'up' | 'down'

export interface Placement {
  side: Side
  edge: Edge
}

export interface Layout {
  window: Size
  orb: Rect | null
  panel: Rect | null
  /** A whisper needs room beside the orb without the panel opening. */
  whisper: Rect | null
}

export const ROLE_LABEL: Record<RoleFamily, string> = {
  swe: 'software engineering',
  backend: 'backend',
  frontend: 'frontend',
  fullstack: 'full stack',
  mobile: 'mobile',
  infra: 'infrastructure',
  security: 'security',
  ml: 'machine learning'
}

/** The families the student aims at, said the way the companion says them. */
export function labelRoles(roles: readonly RoleFamily[]): string {
  return roles.map((role) => ROLE_LABEL[role]).join(' and ')
}
