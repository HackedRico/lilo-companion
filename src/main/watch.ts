/**
 * Deciding when a lecture reaches the concept a student asked to be tapped on.
 * Deliberately not a model call: this fires in the middle of a lecture, so it
 * has to be instant, free, and the same every time.
 */

const NOISE = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'are', 'be'
])

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Enough stemming that "testing" and "test" are the same word, and not so much
 * that "hypothesis" and "hypotheses" fall apart.
 */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (
    word.length > 3 &&
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    !word.endsWith('is') &&
    !word.endsWith('us')
  ) {
    return word.slice(0, -1)
  }
  return word
}

function contentStems(text: string): string[] {
  return normalise(text)
    .split(' ')
    .filter((word) => word.length > 2 && !NOISE.has(word))
    .map(stem)
}

/**
 * The phrase itself, or every word that carries meaning in it. "Testing" alone
 * never wakes a student who is waiting for hypothesis testing.
 */
export function matchesWatch(line: string, concept: string): boolean {
  const phrase = normalise(concept)
  if (!phrase) return false
  if (` ${normalise(line)} `.includes(` ${phrase} `)) return true
  const wanted = contentStems(concept)
  if (wanted.length === 0) return false
  const spoken = contentStems(line)
  return wanted.every((word) => spoken.some((heard) => sameWord(word, heard)))
}

/**
 * Two forms of the same word. "significance" and "significant" pass, because a
 * review and a lecturer will not pick the same ending. "power" and "powerful"
 * do not, because that is a different word wearing the same start.
 */
function sameWord(wanted: string, heard: string): boolean {
  if (wanted === heard) return true
  if (wanted.length < 5 || heard.length > wanted.length + 2) return false
  let shared = 0
  while (shared < Math.min(wanted.length, heard.length) && wanted[shared] === heard[shared]) shared++
  return shared >= wanted.length - 2
}

export function firstMatch(line: string, watching: string[]): string | null {
  return watching.find((concept) => matchesWatch(line, concept)) ?? null
}
