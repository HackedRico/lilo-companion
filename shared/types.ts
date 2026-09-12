import type { Rung, Tier, Trace } from './leetcode.ts'

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

export interface Gap {
  practice: string
  pctOfPostings: number
  exampleSentence: Sentence
}

export interface ChatMessage {
  id: string
  thread: 'companion' | string
  role: 'user' | 'assistant'
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

export type Speaker = 'companion' | 'user'

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
  evidence?: Evidence
  citations?: string[]
  /** Resolved citations, rendered as chips under a chat answer. */
  sources?: Evidence[]
  /** Set on a LeetCode hint, so the thread can say how much it gave away. */
  rung?: Rung
  /** A dry run beside a hint, drawn in the thread and stepped through there. */
  trace?: Trace
}

export type Intent =
  | { kind: 'why' }
  | { kind: 'watch'; concept: string }
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
  | { kind: 'trace' }

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
 * Where what the student types goes next: onboarding, leetcode, or general chat.
 */
export interface ComposerMode {
  mode: 'chat' | 'onboarding' | 'leetcode'
  hint: string
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
  composer: ComposerMode
  onboarded: boolean
  modelConfigured: boolean
  /** Voice mode, kept by main, so the microphone grant can read it too. */
  voice: boolean
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
