import { escapeRegExp } from '../ikb/tag.ts'

/**
 * Whether a line typed to the companion is asking about an interview at a
 * company, and which one. The company has to sit beside the word, because
 * several companies in the base are ordinary words: "linear probing before
 * my interview" is not about Linear. A company the base knows wins, in the
 * order the student named them; a capitalised name beside the word is the
 * fallback for one it does not.
 */

const WORDS = "interview(?:s|ing|ed)?|onsite|on-site|phone screen|loop"
const ASKING = new RegExp(`\\b(?:${WORDS})\\b`, 'gi')

/** How many words may sit between the company and the word: "interview process at Stripe". */
const BETWEEN = 2

/** Capitalised because it starts a sentence or names a day, not because it is a company. */
const NOT_A_NAME = new Set([
  'I', 'My', 'The', 'A', 'An', 'How', 'What', 'When', 'Where', 'Why', 'Who', 'Is', 'Are', 'Do', 'Does',
  'Can', 'Could', 'Should', 'Would', 'Will', 'Tell', 'Give', 'Help', 'Prepare', 'Any', 'Got', 'Have', 'Had',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Today', 'Tomorrow',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'
])

/** A name as typed: capitalised, with dots or hyphens only inside it. */
const NAME = "[A-Z][A-Za-z0-9&]*(?:[.-][A-Za-z0-9&]+)*"

function wordsBetween(text: string, from: number, to: number): number {
  return (text.slice(from, to).match(/[A-Za-z0-9']+/g) ?? []).length
}

/** The company's name, however cased, not running into a neighbouring word. */
export function companyPattern(company: string): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(company)}(?![A-Za-z0-9_-])`, 'gi')
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
      if (beside(at, at + match[0].length)) found.push({ at, name: company })
    }
  }
  // "interview at Coinbase", "Coinbase interview", "Ramp's onsite": a name the base does not know.
  const typed = new RegExp(`\\b(?:at|with|for|from)\\s+(${NAME})|(${NAME})(?:'s)?\\s+(?:${WORDS})\\b`, 'g')
  for (const match of text.matchAll(typed)) {
    const name = match[1] ?? match[2] ?? ''
    if (!name || NOT_A_NAME.has(name)) continue
    found.push({ at: match.index ?? 0, name })
  }
  found.sort((a, b) => a.at - b.at)
  return found[0]?.name ?? null
}
