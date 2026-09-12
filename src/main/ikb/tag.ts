import type { RoleFamily, Seniority } from '../../shared/types'

/**
 * Turning a job posting into tagged sentences. Pure, so the ingest script and
 * the app share one implementation and the tests can reach it directly.
 */

export interface Term {
  term: string
  aliases: string[]
}

export interface Matcher {
  term: string
  patterns: { re: RegExp; strict: boolean }[]
}

/**
 * Short words that are also ordinary English. In postings they turn up inside
 * lists ("Python, Go, Rust"), so a separator nearby is what tells them apart.
 */
const AMBIGUOUS = new Set(['Go', 'R', 'C', 'Spring', 'Excel'])

/** A term may not run into a neighbouring word, version number or extension. */
const EDGE = '[A-Za-z0-9+#&.]'

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…'
}

export function unescapeHtml(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16))
    }
    if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10))
    return ENTITIES[body.toLowerCase()] ?? whole
  })
}

/** Greenhouse hands back escaped HTML, so unescape twice before stripping. */
export function htmlToText(input: string): string {
  const once = unescapeHtml(input)
  const html = once.includes('&lt;') ? unescapeHtml(once) : once
  return unescapeHtml(
    html
      .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<\s*li[^>]*>/gi, '\n')
      .replace(/<\s*br[^>]*>/gi, '\n')
      .replace(/<\s*\/\s*(p|div|li|ul|ol|h[1-6]|tr)\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\r/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

const SENTENCE_MIN = 40
const SENTENCE_MAX = 320

/** Postings are mostly bullets, so lines split before punctuation does. */
export function splitSentences(text: string): string[] {
  const out: string[] = []
  for (const line of text.split('\n')) {
    const cleaned = line.replace(/^\s*[•\-*•●]\s*/, '').trim()
    if (!cleaned) continue
    for (const piece of cleaned.split(/(?<=[.!?])\s+(?=[A-Z(])/)) {
      const sentence = piece.trim().replace(/[;,]$/, '')
      if (sentence.length >= SENTENCE_MIN && sentence.length <= SENTENCE_MAX) out.push(sentence)
    }
  }
  return out
}

const BOILERPLATE = [
  /equal opportunity/i,
  /without regard to/i,
  /reasonable accommodation/i,
  /e-verify/i,
  /salary range|compensation range|base pay|pay range|total compensation/i,
  /benefits (include|package)/i,
  /we are committed to (diversity|building)/i,
  /background check/i,
  /visa sponsorship/i,
  /applicants? (with|must)/i,
  /privacy (policy|notice)/i,
  /click here|learn more at/i
]

export function isBoilerplate(sentence: string): boolean {
  return BOILERPLATE.some((pattern) => pattern.test(sentence))
}

const ROLE_RULES: [RegExp, RoleFamily][] = [
  [/\b(sre|site reliability|devops|platform engineer|infrastructure engineer)\b/i, 'devops'],
  [/\b(security|appsec|infosec|cryptograph)/i, 'security'],
  [
    // No trailing boundary: several of these are prefixes, and a boundary after
    // "data scien" can never match the "t" in "Data Scientist".
    /\b(data scien|data analy|data engineer|machine learning|ml engineer|analytics|analyst|research scientist|quantitative|statistician|econometric|business intelligence)/i,
    'data'
  ],
  [/\b(product manager|program manager|product owner|tpm)\b/i, 'pm'],
  [/\b(designer|design|ux|ui researcher)\b/i, 'design'],
  [/\b(software|engineer|developer|backend|frontend|front.end|back.end|full.stack|mobile|ios|android)\b/i, 'swe']
]

export function classifyRole(title: string): RoleFamily {
  for (const [pattern, family] of ROLE_RULES) if (pattern.test(title)) return family
  return 'other'
}

const SENIORITY_RULES: [RegExp, Seniority][] = [
  [/\b(intern|internship|co-?op)\b/i, 'intern'],
  [/\b(new ?grad|university ?grad|campus|early career|graduate program)\b/i, 'new_grad'],
  [/\b(senior|staff|principal|lead|sr\.?|director|head of)\b/i, 'senior'],
  [/\b(junior|associate|entry.level|jr\.?|\bi\b)\b/i, 'junior']
]

export function classifySeniority(title: string): Seniority {
  for (const [pattern, level] of SENIORITY_RULES) if (pattern.test(title)) return level
  return 'mid'
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildMatchers(terms: Term[]): Matcher[] {
  return terms.map(({ term, aliases }) => ({
    term,
    // Strictness belongs to the ambiguous word, not to the term it stands for:
    // "Golang" is never in doubt even though "Go" always is.
    patterns: [term, ...aliases].map((word) => {
      const strict = AMBIGUOUS.has(word)
      return {
        re: new RegExp(`(?<!${EDGE})${escapeRegExp(word)}(?!${EDGE})`, strict ? 'g' : 'gi'),
        strict
      }
    })
  }))
}

/** A strict term counts only where a list separator sits beside it. */
function inList(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 2), start)
  const after = text.slice(end, end + 2)
  return /[,/|(]\s?$/.test(before) || /^\s?[,/|)]/.test(after)
}

export function tagText(text: string, matchers: Matcher[]): string[] {
  const found = new Set<string>()
  for (const matcher of matchers) {
    for (const { re, strict } of matcher.patterns) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(text)) !== null) {
        if (!strict || inList(text, match.index, match.index + match[0].length)) {
          found.add(matcher.term)
          break
        }
      }
      if (found.has(matcher.term)) break
    }
  }
  return [...found]
}
