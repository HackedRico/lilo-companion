---
name: companion-prompts
description: Changes what the model is asked and what it may say back: prompts, response schemas, the coworker gate and the citation filter. Use when editing shared/prompts.ts, shared/schemas.ts, main/scenario, main/chat or main/pipeline, or when a reply leaks a hidden fact, invents a citation or fails to parse.
---

# Companion prompts

Two rules hold across every prompt, and code enforces both. **The LLM translates, role-plays and explains; real postings prove.** `CitationFilter` strips any `[S:id]` the retriever did not return this turn. **The coworker is only ever told what the student has already uncovered.** `ScenarioRun.ask` is two calls: `revealFacts` decides which hidden facts the question reaches, then `personaReply` is written with only those. `docs/architecture.md` under "Two rules" is the reasoning. A change that moves either gate into prompt wording alone is a regression, however well the prompt reads.

## Shape of a call

Every prompt is a function in `shared/prompts.ts` returning `{ system, user }`. Every JSON reply is parsed through a schema in `shared/schemas.ts`, and the schema is the gate: the endpoints in use offer JSON mode without schema enforcement, so nothing reaches the app that Zod did not accept. A call names a lane, `fast` for keeping up with the lecture and playing the coworker, `strong` for writing the scenario and the review.

`VOICE` at the top of `prompts.ts` is the companion's register and every conversational prompt inherits it. A prompt that reads well to a person and breaks the voice is the wrong prompt. Every prompt also says the student is a software engineering student and its worked example is a software one; a small model handed a prompt without that drifts generic.

## Changing a prompt

1. Edit the function in `prompts.ts`. Keep `JSON_ONLY` on any prompt that is parsed, and keep the schema line in the system prompt in step with the Zod schema.
2. If the reply shape changes, change the schema first, with bounds loose enough that a small open model passes them: `min` and `max` on every string and array, never an exact count.
3. Run `node --test main/session.test.ts`. `ScriptedLlm` there answers every schema from a script and records every `Ask`, so a test can assert what was sent, including that the persona prompt carries only uncovered facts and that an invented citation is dropped.
4. Try it on a real model with `LILO_DEBUG_LLM=1`, which prints every raw reply, over a replayed lecture. The `run-lilo` skill has the steps. Small models drift: the translate prompt hands back the academic name unless the worked example holds it to the menu.

Done when the session test passes, a raw reply from the `fast` lane parses, and the commit says which model it was tried on.

## Adding a call

- One function in `prompts.ts`, one schema in `schemas.ts`, one branch in `ScriptedLlm.reply`, so the loop test still runs without a network.
- The call goes through `LlmLike`, one of `json`, `text` or `stream`, never through the OpenAI client directly. Calls queue behind one timeout, so a call that can hang holds up everything behind it.
- Anything the model returns that names a posting, a term or a fact is checked against what was retrieved before it is shown, the way `resolveTerms` and `CitationFilter` do.
