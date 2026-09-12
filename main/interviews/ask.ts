import { escapeRegExp } from '../ikb/tag.ts'

/**
 * Whether a line typed to the companion is asking about an interview at a
 * company, and which one. The company has to sit beside the word, because
 * several companies in the base are ordinary words: "linear probing before
 * my interview" is not about Linear. A company the base knows wins, in the
 * order the student named them; a name the base does not know is the
 * fallback, and it has to sit where only the company sits, because what comes
 * of it is said out loud as "I am reading what people wrote about
 * interviewing at X". A brief about Sarah is worse than no brief at all, so
 * an unknown name that is not clearly the interviewer is dropped and the
 * line falls through to ordinary chat.
 */

// "loop" is deliberately absent: a student working a problem says "my loop".
const WORDS = "interview(?:s|ing|ed)?|onsite|on-site|phone screen"
const ASKING = new RegExp(`\\b(?:${WORDS})\\b`, 'gi')

/** How many words may sit between the company and the word: "interview process at Stripe". */
const BETWEEN = 2

/** The name becomes a cache filename, and nothing this long was ever a company. */
const MAX_NAME = 60

/** Capitalised because it starts a sentence or names a day, not because it is a company. */
const NOT_A_NAME = new Set([
  'I', 'My', 'The', 'A', 'An', 'How', 'What', 'When', 'Where', 'Why', 'Who', 'Is', 'Are', 'Do', 'Does',
  'Can', 'Could', 'Should', 'Would', 'Will', 'Tell', 'Give', 'Help', 'Prepare', 'Any', 'Got', 'Have', 'Had',
  'This', 'That', 'These', 'Those', 'It', 'Its', 'Their', 'Your', 'Our', 'His', 'Her', 'Every', 'Each',
  'Another', 'Other', 'Both', 'All', 'Some', 'No', 'Not', 'Next', 'Last', 'First', 'Final', 'Also', 'And',
  'But', 'Or', 'So', 'Then', 'Just', 'Now', 'Maybe', 'Please', 'Thanks', 'Hi', 'Hey', 'Ok', 'Okay', 'Yes',
  'If', 'Was', 'Were', 'Am', 'Be', 'Been', 'Let', 'Need', 'Want', 'Know', 'Think', 'Show', 'Explain', 'Walk',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Today', 'Tomorrow',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
])

/**
 * The words of the search itself, lowercased: the track, the stage, or the
 * site the student practises on. "Software Engineer interviews" and "Leetcode
 * interviews" read like "Stripe interviews" and are nothing like it, and no
 * board holds a first-hand account of interviewing at Backend.
 */
const NOT_A_COMPANY = new Set([
  'software', 'backend', 'back-end', 'frontend', 'front-end', 'fullstack', 'full-stack', 'engineer',
  'engineering', 'developer', 'dev', 'swe', 'sde', 'intern', 'internship', 'internships', 'grad', 'junior',
  'senior', 'data', 'ml', 'devops', 'sre', 'qa', 'security', 'platform', 'mobile', 'embedded', 'infra',
  'cloud', 'hr', 'oa', 'phone', 'technical', 'behavioral', 'behavioural', 'coding', 'system', 'design',
  'onsite', 'screen', 'round', 'rounds', 'offer', 'resume', 'referral', 'recruiter', 'recruiting', 'career',
  'careers', 'job', 'jobs', 'role', 'roles', 'prep', 'leetcode', 'neetcode', 'hackerrank', 'codesignal',
  'codility', 'hirevue', 'karat', 'glassdoor', 'blind', 'handshake', 'faang', 'big', 'tech'
])

/**
 * Where something is kept or done, not who is doing the interviewing: "I keep
 * my interview prep in Notion" names a tool the student uses, and the base
 * knowing Notion does not make it the company they are asking about.
 */
const NOT_THE_INTERVIEWER = new Set(['in', 'on', 'into', 'inside', 'using', 'via', 'through'])

/**
 * When the interview is, which is what follows a company and not a person:
 * "an interview at Datadog next week" says where, "a phone screen with John
 * tomorrow" says who.
 */
const WHEN = new Set([
  'next', 'this', 'last', 'tomorrow', 'today', 'tonight', 'soon', 'later', 'on', 'in', 'at',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
])

/** A name as typed: capitalised, with dots or hyphens only inside it. */
const NAME = "[A-Z][A-Za-z0-9&]*(?:[.-][A-Za-z0-9&]+)*"

/**
 * A name does not stop at its first word. "Jane Street" cut down to "Jane" is
 * not a shorter answer, it is a different and wrong one, so the run takes the
 * capitalised words after it and the "of" or "&" that joins them.
 */
const NAME_RUN = `${NAME}(?:\\s+(?:of\\s+|&\\s+)?${NAME})*`

function wordsBetween(text: string, from: number, to: number): number {
  return (text.slice(from, to).match(/[A-Za-z0-9']+/g) ?? []).length
}

/** The company's name, however cased, not running into a neighbouring word. */
export function companyPattern(company: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(company)}(?![A-Za-z0-9_-])`, 'gi')
}

/** The word in front of the name, which says what the name is doing in the sentence. */
function introducer(text: string, at: number): string {
  return (/([A-Za-z]+)[^A-Za-z]*$/.exec(text.slice(0, at))?.[1] ?? '').toLowerCase()
}

/** A run of capitalised words reaches past the name into the sentence, "Datadog I think", so that is given back. */
function trimmed(run: string): string {
  const parts = run.split(/\s+/)
  while (parts.length > 0 && NOT_A_NAME.has(parts[parts.length - 1]!)) parts.pop()
  return parts.join(' ')
}

/** A name reads as a company when it is not the sentence around it, a role, or a practice site. */
function couldBeACompany(name: string): boolean {
  const first = name.split(/\s+/)[0] ?? ''
  return name.length > 0 && name.length <= MAX_NAME && !NOT_A_NAME.has(first) && !NOT_A_COMPANY.has(first.toLowerCase())
}

/**
 * Nothing follows the name but the end of the line or the end of the phrase.
 * A company is the last thing in the phrase that names it, where a person or
 * a place carries on: "Sarah from recruiting", "Berkeley career fair".
 */
function endsThePhrase(text: string, end: number): boolean {
  return /^\s*(?:[.,;:!?)]|$)/.test(text.slice(end))
}

/** The next word says when the interview is, so the word before it was where. */
function whenFollows(text: string, end: number): boolean {
  return WHEN.has((/^\s+([A-Za-z]+)/.exec(text.slice(end))?.[1] ?? '').toLowerCase())
}

export function interviewAsk(text: string, companies: readonly string[]): string | null {
  const words = [...text.matchAll(ASKING)].map((match) => ({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
  if (words.length === 0) return null

  const beside = (start: number, end: number): boolean =>
    words.some((word) => (word.end <= start ? wordsBetween(text, word.end, start) : wordsBetween(text, end, word.start)) <= BETWEEN)

  const found: { at: number; name: string }[] = []
  for (const company of companies) {
    for (const match of text.matchAll(companyPattern(company))) {
      const at = match.index ?? 0
      if (!beside(at, at + match[0].length)) continue
      if (NOT_THE_INTERVIEWER.has(introducer(text, at))) continue
      found.push({ at, name: company })
    }
  }
  // "interview at Coinbase", "Coinbase interview", "Ramp's onsite": a name the base
  // does not know. It has to sit beside the word like a known company does, or
  // "is my loop wrong for Two Sum" reads as an interview at a company called Two.
  // "for" is not one of the prepositions: "for Backend", "for Leetcode interviews"
  // and "for Software Engineer roles" say what the student is preparing for, never
  // who is interviewing them.
  const typed = new RegExp(`\\b(at|with|from)\\s+(${NAME_RUN})|(${NAME_RUN})(?:'s)?\\s+(?:${WORDS})\\b`, 'g')
  for (const match of text.matchAll(typed)) {
    const preposition = (match[1] ?? '').toLowerCase()
    const name = trimmed(match[2] ?? match[3] ?? '')
    if (!couldBeACompany(name)) continue
    const at = text.indexOf(name, match.index ?? 0)
    const end = at + name.length
    if (!beside(at, end)) continue
    if (NOT_THE_INTERVIEWER.has(introducer(text, at))) continue
    // A name the base does not know says nothing about itself, so the sentence has
    // to. It stands in front of the word, "Datadog interview"; or it ends the
    // phrase, "an onsite with Datadog"; or it is where the interview is and when
    // follows it, "at Datadog next week". Nothing else: "with John tomorrow" reads
    // exactly like a company would there, so it is let go rather than guessed at.
    const theInterviewer =
      !preposition || endsThePhrase(text, end) || (preposition === 'at' && whenFollows(text, end))
    if (theInterviewer) found.push({ at, name })
  }
  found.sort((a, b) => a.at - b.at)
  return found[0]?.name ?? null
}
