import assert from 'node:assert/strict'
import { test } from 'node:test'
import { interviewAsk } from './ask.ts'

const KNOWN = ['Stripe', 'Coinbase', 'Brex']

test('a company the base knows is recognised however it is cased', () => {
  assert.equal(interviewAsk("what's the stripe interview like", KNOWN), 'Stripe')
  assert.equal(interviewAsk('I have an onsite with Coinbase next week', KNOWN), 'Coinbase')
  assert.equal(interviewAsk('interviewing at brex, anything I should know?', KNOWN), 'Brex')
})

test('a company the base does not know is read off the sentence', () => {
  assert.equal(interviewAsk('what is a Datadog interview like', KNOWN), 'Datadog')
  assert.equal(interviewAsk('I got a phone screen at Ramp', KNOWN), 'Ramp')
  assert.equal(interviewAsk('any tips for an interview with Snowflake', KNOWN), 'Snowflake')
})

test('no interview, or no company, is not an ask', () => {
  assert.equal(interviewAsk('tell me about hash tables', KNOWN), null)
  assert.equal(interviewAsk('how do I prepare for interviews', KNOWN), null)
  assert.equal(interviewAsk('How do interviews work', KNOWN), null)
  assert.equal(interviewAsk('My interview is tomorrow', KNOWN), null)
})
