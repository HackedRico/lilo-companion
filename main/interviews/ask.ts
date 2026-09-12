/**
 * Whether a line typed to the companion is asking about an interview at a
 * company, and which one. A heuristic, kept small on purpose: a company the
 * base already knows wins, then a capitalised name beside the word.
 */

const ASKING = /\b(interview(s|ing|ed)?|onsite|on-site|phone screen)\b/i

/** Words that look like a name because they start a sentence. */
const NOT_A_NAME = new Set([
  'I', 'My', 'The', 'A', 'An', 'How', 'What', 'When', 'Where', 'Why', 'Who', 'Is', 'Are', 'Do', 'Does',
  'Can', 'Could', 'Should', 'Would', 'Will', 'Tell', 'Give', 'Help', 'Prepare', 'Any', 'Got', 'Have', 'Had'
])

export function interviewAsk(text: string, companies: readonly string[]): string | null {
  if (!ASKING.test(text)) return null
  for (const company of companies) {
    const escaped = company.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i').test(text)) return company
  }
  // "interview at Coinbase", "Coinbase interview", "onsite with Brex".
  const after = text.match(/\b(?:at|with|for|from)\s+([A-Z][A-Za-z0-9.&-]{1,30})/)
  const before = text.match(/\b([A-Z][A-Za-z0-9.&-]{1,30})\s+(?:interview|onsite|on-site|phone screen)/)
  for (const found of [after, before]) {
    const name = found?.[1]
    if (name && !NOT_A_NAME.has(name)) return name
  }
  return null
}
