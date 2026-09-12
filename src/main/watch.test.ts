import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firstMatch, matchesWatch } from './watch.ts'

test('the lecture reaching the concept fires the tap', () => {
  assert.ok(matchesWatch('Today we answer that. This is hypothesis testing.', 'hypothesis testing'))
  assert.ok(matchesWatch('so the null hypothesis is what we test against', 'hypothesis testing'))
})

test('a word the concept happens to share does not fire it', () => {
  assert.ok(!matchesWatch('we will be testing your patience today', 'hypothesis testing'))
  assert.ok(!matchesWatch('unit testing is on the problem set', 'hypothesis testing'))
  assert.ok(!matchesWatch('last week we talked about sampling variability', 'hypothesis testing'))
})

test('punctuation and hyphens do not hide a match', () => {
  assert.ok(matchesWatch('That is the p-value, and it is often misread.', 'p value'))
  assert.ok(matchesWatch("the lecturer's point about Type I error", 'type i error'))
})

test('plurals still count', () => {
  assert.ok(matchesWatch('we compute confidence intervals for each group', 'confidence interval'))
})

test('a one word concept needs the word itself, not a fragment', () => {
  assert.ok(matchesWatch('this is where power comes in', 'power'))
  assert.ok(!matchesWatch('powerful machines run the tests', 'power'))
})

test('a lecturer and a review rarely pick the same word endings', () => {
  // What a review names, against what a lecturer actually says.
  assert.ok(matchesWatch('we call anything below it statistically significant', 'statistical significance'))
  assert.ok(matchesWatch('so we are testing a hypothesis here', 'hypothesis testing'))
})

test('every word in the concept has to turn up, even when one is only a modifier', () => {
  // A lecturer who says "power" without saying "statistical" is missed. That is
  // the deliberate trade: a tap that never comes beats one that fires on
  // "significant effort", because this interrupts someone in a lecture.
  assert.ok(!matchesWatch('the power of a test depends on the sample', 'statistical power'))
  assert.ok(matchesWatch('the statistical power of a test depends on the sample', 'statistical power'))
})

test('loose endings do not loosen what counts as a match', () => {
  assert.ok(!matchesWatch('statistically speaking the room is warm', 'statistical significance'))
  assert.ok(!matchesWatch('significant effort went into the slides', 'statistical significance'))
})

test('only the watched concept comes back from a list', () => {
  const watching = ['hypothesis testing', 'statistical power']
  assert.equal(firstMatch('now we turn to statistical power', watching), 'statistical power')
  assert.equal(firstMatch('nothing relevant is being said here', watching), null)
})
