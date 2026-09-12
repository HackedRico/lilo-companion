import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { readLecture } from './lecture.ts'

test('a lecture written on either OS comes back one line per thing said', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-'))
  const path = join(dir, 'lecture.txt')
  await writeFile(path, 'Today we start on hash tables.\r\n\r\n  A hash table is an array.  \r\n')
  assert.equal(await readLecture(path), 'Today we start on hash tables.\nA hash table is an array.')
})

test('a markdown lecture comes back with blank lines stripped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-md-'))
  const path = join(dir, 'lecture.md')
  await writeFile(path, '# Graph Algorithms\n\n- Breadth-first search\n- Depth-first search\n')
  assert.equal(await readLecture(path), '# Graph Algorithms\n- Breadth-first search\n- Depth-first search')
})

test('a pdf lecture extracts text lines cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-pdf-'))
  const path = join(dir, 'lecture.pdf')
  const stream = 'BT /F1 12 Tf 100 700 Td (Distributed consensus and Raft.) Tj ET'
  const pdfBytes =
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<</Font<</F1<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>>>>>/Contents 4 0 R>>endobj\n' +
    '4 0 obj<</Length ' +
    stream.length +
    '>>stream\n' +
    stream +
    '\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000252 00000 n \ntrailer<</Size 5/Root 1 0 R>>\nstartxref\n345\n%%EOF'

  await writeFile(path, Buffer.from(pdfBytes))
  const text = await readLecture(path)
  assert.equal(text, 'Distributed consensus and Raft.')
})

test('a pptx lecture extracts slides and speaker notes in order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lilo-pptx-'))
  const path = join(dir, 'lecture.pptx')

  const zip = new JSZip()
  const slide1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Lecture 4: Database Indexing &amp; B-Trees</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

  const slide2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Why B-Trees?</a:t></a:r></a:p>
    <a:p><a:r><a:t>Minimizing disk I/O with wide fanout</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>`

  const notes1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody>
    <a:p><a:r><a:t>Remind students that indexes have write amplification overhead.</a:t></a:r></a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`

  zip.file('ppt/slides/slide1.xml', slide1)
  zip.file('ppt/slides/slide2.xml', slide2)
  zip.file('ppt/notesSlides/notesSlide1.xml', notes1)

  const buffer = await zip.generateAsync({ type: 'nodebuffer' })
  await writeFile(path, buffer)

  const text = await readLecture(path)
  assert.equal(
    text,
    [
      'Lecture 4: Database Indexing & B-Trees',
      'Why B-Trees?',
      'Minimizing disk I/O with wide fanout',
      'Remind students that indexes have write amplification overhead.'
    ].join('\n')
  )
})
