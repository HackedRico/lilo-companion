import { readFile } from 'node:fs/promises'

/**
 * A lecture the student hands over whole: a transcript, captions, or notes.
 * Kept as one line per thing said, because the watch looks for a concept on
 * the line where the lecturer said it, and a file written on Windows carries
 * \r\n.
 */
export async function readLecture(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}
