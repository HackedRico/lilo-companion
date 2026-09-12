import type { RoleFamily, Seniority } from '../../shared/types.ts'

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
const AMBIGUOUS = new Set(['Go', 'R', 'C', 'Spring'])

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

/** A title is software engineering when it says so. Anything else is not evidence. */
const ENGINEERING = /\b(software|engineer|engineering|developer|programmer|sre|devops)\b/i

/**
 * Titles that carry an engineering word and are still not the job a student is
 * aiming at: management, the customer-facing kinds of engineer, and the roles
 * that borrow the word from another discipline.
 */
const NOT_ENGINEERING = [
  /\b(manager|director|head of|vp|vice president|chief|recruit)/i,
  /\b(sales|solutions?|pre-?sales|support|customer|field|partner|consulting|enablement|services)\s+(\w+\s+)?engineer/i,
  /\b(developer|engineering) (advocate|relations|onboarding)\b|\bdevrel\b/i,
  /\b(electrical|hardware|physical|legal|business systems?|it|grc|analytics|analytical|events?|risk|threat|applications?|technical services)\s+(\w+\s+){0,2}engineer/i,
  /\b(site engineer|network (deployment|hardware)|data center|supply|administrative|marketing|designer|product manager|program manager|abuse research)\b/i
]

/**
 * What the posting is about, first match wins. The kind of code someone writes
 * comes before the domain it runs in, so "Backend Engineer, Infrastructure" is
 * backend and "Cloud Security Engineer" is security.
 */
const TRACK_RULES: [RegExp, RoleFamily][] = [
  [/\b(ios|android|mobile)\b/i, 'mobile'],
  [/\b(front.?end|web|ui|ux)\b/i, 'frontend'],
  [/\b(back.?end|server|distributed systems|databases?|apis?|streaming|postgres)\b/i, 'backend'],
  [/\b(full.?stack|product engineer)\b/i, 'fullstack'],
  [/\b(security|appsec|infosec|detection|privacy|cryptograph|iam|ciam)\b/i, 'security'],
  [
    // No trailing boundary: "machine learning" is a prefix of "Machine Learning
    // Engineer" and a boundary after it can never match the space.
    /\b(machine learning|ml|ai engineer|applied ai|ai research|research engineer|inference|computer vision|deep learning|llm|nlp|data engineer)/i,
    'ml'
  ],
  [
    /\b(sre|site reliability|devops|platform engineer|infrastructure|infra|cloud|network(ing)?|observability|reliability|compute|cdn|storage|kubernetes|deployment|developer (experience|productivity|platform))\b/i,
    'infra'
  ]
]

/** The track a software engineering title is on, or null when it is not one. */
export function classifyRole(title: string): RoleFamily | null {
  if (!ENGINEERING.test(title)) return null
  if (NOT_ENGINEERING.some((pattern) => pattern.test(title))) return null
  for (const [pattern, family] of TRACK_RULES) if (pattern.test(title)) return family
  return 'swe'
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
