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

test('a company with more than one word in its name arrives whole', () => {
  const asks: [string, string][] = [
    ['I have an interview with Jane Street', 'Jane Street'],
    ['what is the Two Sigma onsite like', 'Two Sigma'],
    ['I have an interview at Goldman Sachs', 'Goldman Sachs'],
    ['what is a Capital One interview like', 'Capital One'],
    ['I have an onsite with Bank of America', 'Bank of America'],
    ['what is the Palo Alto Networks interview like', 'Palo Alto Networks']
  ]
  for (const [line, company] of asks) assert.equal(interviewAsk(line, KNOWN), company, line)
})

test('a role, a practice site or a word from the sentence is never a company', () => {
  // These cannot be settled by asking a board, because no board would answer
  // for them in a way worth showing, so they are settled here.
  const notAsks = [
    'I have an interview for Software Engineer roles',
    'I have an interview for Backend next week',
    'what do I need for Leetcode interviews',
    'any advice for This interview',
    'prepping for OA then interview',
    'interview with HR next week',
    'I keep my interview prep in Notion',
    'is my loop wrong for Two Sum',
    'how do I prepare for interviews'
  ]
  for (const line of notAsks) assert.equal(interviewAsk(line, KNOWN), null, line)
})

test('a name that could be a person is handed on, for the boards to settle', () => {
  // Nothing in the sentence separates "with Sarah from recruiting" from "with
  // Two Sigma next week", and a rule strict enough to refuse the first refused
  // "what is the interview at Google like" as well. So the name goes through
  // and `interviews` in session.ts asks the boards about it: a write-up titled
  // for the name is the evidence, and nothing said where there is none.
  assert.equal(interviewAsk('interview with Sarah from recruiting', KNOWN), 'Sarah')
  assert.equal(interviewAsk('phone screen with John tomorrow', KNOWN), 'John')
  assert.equal(interviewAsk('is the interview at Berkeley career fair worth it', KNOWN), 'Berkeley')
})

test('the phrasings a student actually uses all reach a company', () => {
  // Every one of these answered null until the sentence stopped being asked to
  // prove the name, and none of the companies in them is in the evidence base.
  assert.equal(interviewAsk('what is the interview at Google like?', KNOWN), 'Google')
  assert.equal(interviewAsk("what's the interview process at Google like", KNOWN), 'Google')
  assert.equal(interviewAsk('what is the onsite at Amazon like', KNOWN), 'Amazon')
  assert.equal(interviewAsk('is the interview at Microsoft hard', KNOWN), 'Microsoft')
  assert.equal(interviewAsk('I have a phone screen with Meta on Friday', KNOWN), 'Meta')
  assert.equal(interviewAsk('I have an interview at Datadog next week', KNOWN), 'Datadog')
})

test('a company with more than one word in its name still arrives whole', () => {
  assert.equal(interviewAsk('I have an onsite with Two Sigma next week. What should I expect?', KNOWN), 'Two Sigma')
  assert.equal(interviewAsk('interview with Jane Street next Tuesday', KNOWN), 'Jane Street')
  assert.equal(interviewAsk('I have an interview at Goldman Sachs', KNOWN), 'Goldman Sachs')
  assert.equal(interviewAsk('I have an onsite with Bank of America', KNOWN), 'Bank of America')
})

test('a run of capitalised words is a sentence, not a name a cache can hold', () => {
  const long = `I have an interview at ${'Ableton Bandcamp Cloudera Datadog Elastic '.repeat(4).trim()}`
  assert.equal(interviewAsk(long, KNOWN), null, 'nothing that long is a company')
  assert.equal(interviewAsk('I have an interview at Datadog I think', KNOWN), 'Datadog', 'the run stops before the sentence')
})
