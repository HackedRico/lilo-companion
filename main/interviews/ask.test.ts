import assert from 'node:assert/strict'
import { test } from 'node:test'
import { interviewAsk } from './ask.ts'

const KNOWN = ['Stripe', 'Coinbase', 'Brex', 'Linear', 'Notion', 'Meta']

test('a company the base knows is recognised beside the word, however it is cased', () => {
  assert.equal(interviewAsk("what's the stripe interview like", KNOWN), 'Stripe')
  assert.equal(interviewAsk('I have an onsite with Coinbase next week', KNOWN), 'Coinbase')
  assert.equal(interviewAsk('interviewing at brex, anything I should know?', KNOWN), 'Brex')
  assert.equal(interviewAsk('how does the interview process at Notion go', KNOWN), 'Notion')
})

test('a company the base does not know is read off the sentence, without its full stop', () => {
  assert.equal(interviewAsk('what is a Datadog interview like', KNOWN), 'Datadog')
  assert.equal(interviewAsk('I got a phone screen at Ramp', KNOWN), 'Ramp')
  assert.equal(interviewAsk('I have an interview at Datadog.', KNOWN), 'Datadog')
  assert.equal(interviewAsk("what's Ramp's onsite like", KNOWN), 'Ramp')
})

test('a company named as an ordinary word, away from the interview word, is not an ask about it', () => {
  assert.equal(interviewAsk('can you explain linear probing before my interview tomorrow', KNOWN), null)
  assert.equal(interviewAsk('I have no notion what to expect in this interview', KNOWN), null)
  assert.equal(interviewAsk('any tips for a meta-programming interview', KNOWN), null)
})

test('the company asked about wins, not the first one in the list', () => {
  assert.equal(interviewAsk('I have a Notion interview next week, is it like the Stripe loop', KNOWN), 'Notion')
})

test('no interview, or no company, is not an ask', () => {
  assert.equal(interviewAsk('tell me about hash tables', KNOWN), null)
  assert.equal(interviewAsk('how do I prepare for interviews', KNOWN), null)
  assert.equal(interviewAsk('How do interviews work', KNOWN), null)
  assert.equal(interviewAsk('My interview is tomorrow', KNOWN), null)
  assert.equal(interviewAsk('prep for Monday interview', KNOWN), null)
})

test('a question about the problem in front of them is not an interview ask', () => {
  const known = ['Stripe', 'Coinbase', 'Linear', 'Notion', 'Meta']
  for (const line of [
    'is my loop wrong for Two Sum',
    'should the loop start at Line 4',
    'why does this fail for Python but not Java',
    'my loop is off by one for Example 2',
    'does the loop need to run for N iterations'
  ]) {
    assert.equal(interviewAsk(line, known), null, line)
  }
})

test('every phrasing a student would use routes the way it reads', () => {
  const known = ['Stripe', 'Coinbase', 'Brex', 'Linear', 'Notion', 'Meta', 'Figma', 'Databricks']
  const asks: [string, string][] = [
    ['what is the Stripe interview like', 'Stripe'],
    ["what's the Coinbase interview like", 'Coinbase'],
    ['I have an onsite with Databricks next month, what is it like', 'Databricks'],
    ['I have an interview at Datadog.', 'Datadog'],
    ['how does the interview process at Notion go', 'Notion'],
    ['I got a phone screen at Ramp', 'Ramp'],
    ["what's Ramp's onsite like", 'Ramp'],
    ['interviewing at brex, anything I should know?', 'Brex'],
    ['any tips for an interview with Snowflake', 'Snowflake']
  ]
  for (const [line, company] of asks) assert.equal(interviewAsk(line, known), company, line)

  const notAsks = [
    'is my loop wrong for Two Sum',
    'should the loop start at Line 4',
    'why does this fail for Python but not Java',
    'can you explain linear probing before my interview tomorrow',
    'I have no notion what to expect in this interview',
    'any tips for a meta-programming interview',
    'tell me about hash tables',
    'how do I prepare for interviews',
    'my loop is off by one for Example 2',
    'prep for Monday interview',
    'why is my helper for N iterations slow'
  ]
  for (const line of notAsks) assert.equal(interviewAsk(line, known), null, line)
})
