import { labelRoles, ROLE_LABEL } from './types.ts'
import type { Card, HiddenFact, Posting, Profile, Scenario, Sentence } from './types.ts'
import type { Problem, Rung } from './leetcode.ts'

export interface Prompt {
  system: string
  user: string
}

/**
 * The companion's voice. Everything conversational inherits this, so the tone
 * stays the same whether it is explaining evidence or reviewing an answer.
 */
const VOICE = `You are a companion that sits beside a software engineering student while they study.
You speak plainly and a little dryly, like a friend who already has the job.
One or two short sentences. Never more.
Never write labels like "Concept:" or "Industry term:". Just say it in a sentence.
No bullet points, no headings, no emoji, no exclamation marks.
Never claim anything about industry that was not given to you as evidence.`

const JSON_ONLY = 'Reply with one JSON object and nothing else. No prose, no code fences.'

// Hear -------------------------------------------------------------------

export function extractConcepts(transcript: string): Prompt {
  return {
    system: `You read a few minutes of a lecture a software engineering student is sitting in, and name what is being taught.
Name at most three concepts, the ones they would need to look up.
Skip admin, greetings, and exam logistics. If nothing is being taught, return an empty list.
Confidence is high when the lecturer defines or works through it, low when it is mentioned in passing.
${JSON_ONLY}
Schema: {"concepts":[{"name":string,"summary":string,"confidence":"low"|"medium"|"high"}]}`,
    user: `Lecture transcript:\n"""\n${transcript.slice(-6000)}\n"""`
  }
}

// See --------------------------------------------------------------------

export function translateConcept(concept: string, summary: string, vocabulary: string[]): Prompt {
  return {
    system: `A software engineering student just heard an academic idea in a lecture. Say what software engineering job postings call the same thing.

You are given terms that appear in real postings. Choose three to five of them and copy each one
exactly as it is written. Handing the academic name back is the one thing you must not do:
"amortised analysis" is not a posting term, "performance optimization" is.
Only invent a term if the list has nothing related at all, and then at most one.

Also write one sentence saying where this shows up in the work itself. Address the student as "you".
No company names, no numbers, no first person, under 25 words.

Worked example.
Concept: amortised analysis, the cost of a rare expensive step spread over the cheap ones around it.
Good reply: {"terms":["performance optimization","scalability","system design"],"oneLiner":"Every time someone asks why the tail latency spikes once an hour, this is the answer you are about to give."}

${JSON_ONLY}
Schema: {"terms":[string],"oneLiner":string}`,
    user: `Terms that appear in postings near this idea:
${vocabulary.join(', ')}

Concept: ${concept}
What the lecturer said about it: ${summary}`
  }
}

// Do ---------------------------------------------------------------------

export function generateScenario(
  card: Card,
  sentence: Sentence,
  posting: Posting,
  profile: Profile
): Prompt {
  return {
    system: `You write a work request that a software engineering student practises on. It lands on them as the engineer on a team, and it must feel like real work, which means it is incomplete.

Rules:
- The visible message is vague on purpose. A careful person cannot answer it well without asking questions first.
- Write three to four hidden facts. Each one changes what the right answer is. Do not hint at them in the visible message.
- revealWhen names the kind of question that uncovers that fact, as a noun phrase: "a question about when the change went live".
- The sender is a coworker, not technical, busy, friendly. The persona says how they talk and what they do not know.
- The sender does not know the technique and never names it. They ask about the outcome they care about,
  not the method: "why is the page slow on Mondays", never "can you profile the query plan".
- Write it as a real message to one person the sender already knows. Never use a placeholder like
  [Student], [Name] or [Team], and never address a group.
- The team and the people are fictional. Never use the real company's name inside the message.
- The deliverable is a real artefact an engineer would hand over: a reply they can act on, a PR description, review comments, a short design note. Not an essay.
- classVersion is one line saying how a textbook would have posed the same problem, fully specified.
- The rubric is what a senior would check. Reward asking the questions that uncover the hidden facts, and giving an answer someone can act on. Never reward length.
- An attachment is optional. If present: at most 15 lines of code, or at most 8 rows of a plain text table.
${JSON_ONLY}
Schema: {"title":string,"format":"jira"|"slack"|"email","from":{"name":string,"role":string},"persona":string,"visibleMessage":string,"attachment":{"type":"table"|"code"|"none","content":string},"hiddenFacts":[{"id":string,"fact":string,"revealWhen":string}],"deliverable":string,"classVersion":string,"rubric":[string]}`,
    user: `The student just learned: ${card.concept.name} — ${card.concept.summary}
At work this shows up as: ${card.terms.map((term) => term.term).join(', ')}
A real posting for a ${ROLE_LABEL[posting.roleFamily]} role says: "${sentence.text}"
The student is aiming at: ${labelRoles(profile.targetRoles) || 'software engineering'}

Write the request so that using ${card.concept.name} correctly is the heart of a good answer.`
  }
}

export function revealFacts(scenario: Scenario, question: string): Prompt {
  return {
    system: `A student asked a coworker a question. Decide which hidden facts that question uncovers.
A fact is uncovered only if the question genuinely reaches for it. A vague or unrelated question uncovers nothing.
Return the ids and nothing else.
${JSON_ONLY}
Schema: {"revealedFactIds":[string]}`,
    user: `The request they are working on: ${scenario.visibleMessage}

Facts, and the kind of question that uncovers each:
${scenario.hiddenFacts.map((fact) => `${fact.id} — ${fact.revealWhen}`).join('\n')}

The student asked: "${question}"`
  }
}

/**
 * The persona is only ever handed facts the student has already uncovered, so
 * it cannot leak what it was never given.
 */
export function personaReply(
  scenario: Scenario,
  known: HiddenFact[],
  question: string,
  history: { role: string; text: string }[]
): Prompt {
  return {
    system: `You are ${scenario.from.name}, a ${scenario.from.role}. ${scenario.persona}

You are not technical. You answer only what you were asked, in one or two sentences, the way a busy colleague would.
Never invent a detail. If it is not in what you know below, you do not know it, and you say so plainly.
Never volunteer information you were not asked for.
Never mention rubrics, facts, exercises, or that this is practice. You are just a coworker replying.`,
    user: `The request you sent: ${scenario.visibleMessage}

Everything you know, beyond the message you already sent. There is nothing else. If they ask about
anything not on this list, you do not know it and you say so:
${known.length > 0 ? known.map((fact) => `- ${fact.fact}`).join('\n') : '- nothing at all'}

${history.length > 0 ? `Earlier in this thread:\n${history.map((turn) => `${turn.role}: ${turn.text}`).join('\n')}\n\n` : ''}They just asked: "${question}"`
  }
}

export function reviewSubmission(
  scenario: Scenario,
  uncovered: HiddenFact[],
  missed: HiddenFact[],
  reply: string
): Prompt {
  return {
    system: `You are a senior engineer reviewing a junior's work. You are fair, specific and brief.

Judge against the rubric and against which facts they uncovered before answering.
Missing a fact that changes the answer is the thing that matters most.
strengths and gaps are at most two items each, and every one of them begins with the word "You".
Write "You never asked what the baseline was", never "Did not ask for baseline".
missedTopics names what they should learn next, as a lecturer would say it out loud, at most three
words: "hypothesis testing", "confidence intervals", "selection bias". Never a course title, and never
a phrase like "best practices", "fundamentals" or "techniques". The companion listens for these exact
words in a later lecture, so anything longer is never heard.
seniorQuestion is the one question you would actually ask them next, in one sentence.
Verdict is ship_it only if the answer is actionable and no fact that changes the answer was missed.
${JSON_ONLY}
Schema: {"verdict":"ship_it"|"needs_changes","strengths":[string],"gaps":[string],"missedTopics":[string],"seniorQuestion":string}`,
    user: `The request: ${scenario.visibleMessage}
What they had to produce: ${scenario.deliverable}

Rubric:
${scenario.rubric.map((line) => `- ${line}`).join('\n')}

Facts they uncovered by asking:
${uncovered.length > 0 ? uncovered.map((fact) => `- ${fact.fact}`).join('\n') : '- none'}

Facts they never uncovered:
${missed.length > 0 ? missed.map((fact) => `- ${fact.fact}`).join('\n') : '- none'}

Their answer:
"""
${reply}
"""`
  }
}

// Chat -------------------------------------------------------------------

export function companionChat(
  profile: Profile,
  transcript: string,
  card: Card | null,
  sentences: Sentence[],
  history: { role: string; text: string }[],
  question: string,
  inScenario: boolean
): Prompt {
  return {
    system: `${VOICE}

You never do a student's homework, quiz or exam question for them. If they ask for an answer to
graded work, say plainly that you will not, then explain the idea behind it or offer to give them a
work version to practise on instead.
${inScenario ? 'They are in the middle of a work scenario right now, so give hints and questions to consider, never the answer.' : ''}

When a claim about industry comes from one of the posting sentences below, cite it as [S:id] right
after the claim. Never cite an id that is not listed. If nothing below supports a claim, do not make it.`,
    user: `About the student: software engineering, ${profile.major ? `studying ${profile.major}` : 'course not said'}, ${profile.year || 'year not said'}, aiming at ${labelRoles(profile.targetRoles) || 'no track said yet'}.
${card ? `They are looking at: ${card.concept.name} — ${card.oneLiner}\n` : ''}${transcript ? `Recent lecture:\n"""\n${transcript.slice(-2500)}\n"""\n` : ''}
Posting sentences you may cite:
${sentences.length > 0 ? sentences.map((sentence) => `[S:${sentence.id}] ${sentence.text}`).join('\n') : '(none retrieved)'}

${history.length > 0 ? `Conversation so far:\n${history.map((turn) => `${turn.role}: ${turn.text}`).join('\n')}\n\n` : ''}They said: "${question}"`
  }
}

// Profile ----------------------------------------------------------------

export function extractProfile(history: { role: string; text: string }[]): Prompt {
  return {
    system: `Read a short getting-to-know-you chat with a software engineering student and fill in what they told you.
Leave a field empty rather than guessing. major is what they call their course: computer science, software engineering, computer engineering.
targetRoles is the kind of engineering they are after, using only: swe, backend, frontend, fullstack, mobile, infra, security, ml.
swe is for software engineering with no track named.
${JSON_ONLY}
Schema: {"major":string,"year":string,"courses":[string],"targetRoles":[string],"interests":[string]}`,
    user: history.map((turn) => `${turn.role}: ${turn.text}`).join('\n')
  }
}

// LeetCode ---------------------------------------------------------------

export interface CoachInput {
  problem: Problem
  /** The state read back in plain words, said to the student before this. */
  state: string
  code: string
  language: string
  ceiling: Rung
  /** What the student asked, or null when the companion is volunteering. */
  question: string | null
  /** Why the last reply was refused, when this is the second try. */
  retry: 'too_high' | 'unverified' | null
}

/** The student's code with the line numbers the hint has to use. */
function numbered(code: string): string {
  return code
    .split('\n')
    .map((line, index) => `${String(index + 1).padStart(3)}  ${line}`)
    .join('\n')
}

/**
 * The coach beside a LeetCode problem. The ceiling is stated and the rung is
 * asked for, but neither is trusted: the gate checks the rung, the line
 * numbers and the names against the code before anything is said.
 */
export function coachHint(input: CoachInput): Prompt {
  const again =
    input.retry === 'too_high'
      ? `Your last reply was above the ceiling. Stay at or below rung ${input.ceiling} this time, or return an empty say.`
      : input.retry === 'unverified'
        ? 'Your last reply pointed at a line or a name that is not in their code. Point only at what is there, or return an empty say.'
        : ''
  return {
    system: `${VOICE}

A software engineering student is working a LeetCode problem and you are beside them. You help at a level they set, so the effort stays theirs.

The ladder, by how much of the answer a line gives away:
0 say what you see. 1 a question to think about. 2 name the idea. 3 where their own code goes wrong, and why. 4 the steps. 5 the answer.
Their ceiling right now is rung ${input.ceiling}. Reply at the lowest rung that moves them, never above the ceiling. The rung you report is checked in code, and a reply above the ceiling is thrown away unsaid.

Rules:
- Finish their idea first. Until their own approach works, help that approach. A better approach waits until theirs works.
- Specific or silent. If a line could be said about anyone's code, do not say it. Point at the line numbers and names in their code, and every one you name is checked against it.
- Never write code unless the rung is 5 and they asked for the answer outright. Never paste their code back at them.
- Encouragement is not a hint, so do not pad with it. One or two sentences.
- lines holds the line numbers you are talking about, names the identifiers, both taken only from their code. Both stay empty at rungs 0 to 2 unless one line is the point.
${again}
${JSON_ONLY}
Schema: {"rung":0|1|2|3|4|5,"say":string,"lines":[number],"names":[string]}`,
    user: `Problem: ${input.problem.title} (${input.problem.difficulty})
${input.problem.statement.slice(0, 3000)}

What you see: ${input.state}

Their code, ${input.language || 'language unknown'}, with line numbers:
${numbered(input.code) || '(nothing written yet)'}

${input.question ? `They asked: "${input.question}"` : 'Nobody asked. You are volunteering, so the lowest rung that moves them is the right one.'}`
  }
}
