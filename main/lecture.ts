import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { extractText } from 'unpdf'
import JSZip from 'jszip'

function normaliseLines(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

function decodeXml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
}

function extractXmlParagraphs(xml: string, out: string[]): void {
  const paragraphs = xml.match(/<a:p[\s\S]*?<\/a:p>/g) ?? []
  for (const p of paragraphs) {
    const texts: string[] = []
    const matches = p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)
    for (const m of matches) {
      if (m[1]) texts.push(decodeXml(m[1]))
    }
    const line = texts.join('').trim()
    if (line) out.push(line)
  }
}

async function readPdf(buffer: Buffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })
  return normaliseLines(text)
}

async function readPptx(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide[0-9]+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide([0-9]+)\.xml/)?.[1] ?? '0', 10)
      const numB = parseInt(b.match(/slide([0-9]+)\.xml/)?.[1] ?? '0', 10)
      return numA - numB
    })

  const lines: string[] = []
  for (const slideFile of slideFiles) {
    const content = await zip.file(slideFile)?.async('string')
    if (content) extractXmlParagraphs(content, lines)
  }

  const notesFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/notesSlides\/notesSlide[0-9]+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/notesSlide([0-9]+)\.xml/)?.[1] ?? '0', 10)
      const numB = parseInt(b.match(/notesSlide([0-9]+)\.xml/)?.[1] ?? '0', 10)
      return numA - numB
    })

  for (const notesFile of notesFiles) {
    const content = await zip.file(notesFile)?.async('string')
    if (content) extractXmlParagraphs(content, lines)
  }

  return normaliseLines(lines.join('\n'))
}

/**
 * A lecture the student hands over whole: a transcript, captions, slides or notes.
 * Kept as one line per thing said, because the watch looks for a concept on
 * the line where the lecturer said it, and a file written on Windows carries
 * \r\n.
 */
export async function readLecture(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') {
    const buffer = await readFile(path)
    return readPdf(buffer)
  }
  if (ext === '.pptx') {
    const buffer = await readFile(path)
    return readPptx(buffer)
  }
  const text = await readFile(path, 'utf8')
  return normaliseLines(text)
}
