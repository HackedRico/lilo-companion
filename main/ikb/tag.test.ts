import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildMatchers,
  classifyRole,
  classifySeniority,
  htmlToText,
  isBoilerplate,
  splitSentences,
  tagText,
  unescapeHtml,
  type Term
} from './tag.ts'

const TOOLS: Term[] = [
  { term: 'Java', aliases: [] },
  { term: 'JavaScript', aliases: ['JS'] },
  { term: 'Go', aliases: ['Golang'] },
  { term: 'Node.js', aliases: ['NodeJS', 'Node'] },
  { term: 'C++', aliases: [] },
  { term: 'Kubernetes', aliases: ['K8s'] },
  { term: 'PostgreSQL', aliases: ['Postgres'] }
]

const PRACTICES: Term[] = [
  { term: 'code review', aliases: ['peer review', 'code reviews'] },
  { term: 'A/B testing', aliases: ['experimentation'] },
  { term: 'CI/CD', aliases: ['continuous integration'] }
]

const matchers = buildMatchers([...TOOLS, ...PRACTICES])

test('greenhouse content is escaped twice and comes back as text', () => {
  const raw = '&lt;p&gt;We use &lt;strong&gt;Kubernetes&lt;/strong&gt; daily.&lt;/p&gt;'
  assert.equal(htmlToText(raw), 'We use Kubernetes daily.')
})

test('entities that are not tags still decode', () => {
  assert.equal(unescapeHtml('Sam&rsquo;s team &amp; mine'), 'Sam’s team & mine')
})

test('bullets become sentences and short fragments are dropped', () => {
  const text = htmlToText('<ul><li>Participate in code review and write unit tests daily</li><li>Ship</li></ul>')
  const sentences = splitSentences(text)
  assert.equal(sentences.length, 1)
  assert.match(sentences[0]!, /^Participate in code review/)
})

test('a term never matches inside a longer word', () => {
  assert.deepEqual(tagText('Strong JavaScript experience required here', matchers), ['JavaScript'])
  assert.deepEqual(tagText('Strong Java experience required here', matchers), ['Java'])
})

test('an ambiguous word counts only inside a list', () => {
  assert.deepEqual(tagText('You will Go to market with sales', matchers), [])
  assert.ok(tagText('We write Python, Go, and Rust services', matchers).includes('Go'))
})

test('aliases and dotted names resolve to the canonical term', () => {
  assert.ok(tagText('Experience with Golang services', matchers).includes('Go'))
  assert.ok(tagText('We run Postgres in production', matchers).includes('PostgreSQL'))
  assert.ok(tagText('Built on Node.js and K8s', matchers).includes('Node.js'))
  assert.ok(tagText('Built on Node.js and K8s', matchers).includes('Kubernetes'))
})

test('the practices a lecture is most likely to name come back tagged', () => {
  const review = 'You will participate in code review and mentor other engineers'
  const testing = 'Design and analyse A/B testing to measure feature impact'
  assert.ok(tagText(review, matchers).includes('code review'))
  assert.ok(tagText(testing, matchers).includes('A/B testing'))
  assert.ok(tagText('We practise continuous integration on every merge', matchers).includes('CI/CD'))
})

test('punctuation in a term survives', () => {
  assert.ok(tagText('Fluent in C++ and Java', matchers).includes('C++'))
})

test('titles sort into role families and seniority', () => {
  assert.equal(classifyRole('Senior Backend Engineer'), 'swe')
  assert.equal(classifyRole('Data Scientist, Growth'), 'data')
  assert.equal(classifyRole('Site Reliability Engineer'), 'devops')
  assert.equal(classifyRole('Product Manager, Payments'), 'pm')
  assert.equal(classifyRole('Account Executive'), 'other')
  assert.equal(classifySeniority('Software Engineer Intern'), 'intern')
  assert.equal(classifySeniority('New Grad Software Engineer'), 'new_grad')
  assert.equal(classifySeniority('Staff Engineer'), 'senior')
  assert.equal(classifySeniority('Software Engineer'), 'mid')
})

test('legal and pay boilerplate is refused', () => {
  assert.ok(isBoilerplate('We are an equal opportunity employer and value diversity'))
  assert.ok(isBoilerplate('The salary range for this role is $150,000 to $200,000'))
  assert.ok(!isBoilerplate('You will participate in code review and mentor other engineers'))
})
