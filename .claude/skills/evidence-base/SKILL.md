---
name: evidence-base
description: Changes what the companion can prove: the job boards it reads, the tool and practice vocabularies, tagging, retrieval and gap statistics. Use when editing main/ikb, data/*.json or scripts/ingest-ikb.ts, adding a company, tool or practice, or when a card shows no evidence or the wrong evidence.
---

# Evidence base

Every claim about industry traces to a sentence in `data/ikb.json`, and every sentence to a posting with a URL. The model proposes and the postings decide: a term the index has no hits for is dropped before it reaches a card. `docs/architecture.md` under "The evidence base" is the reasoning. This is how to change it without breaking that chain.

## The chain

1. `nearbyTerms` draws a menu from the postings nearest the concept.
2. The model copies terms off the menu.
3. `resolveTerms` keeps only what the vocabulary maps to a tag with hits.
4. `evidenceFor` quotes three sentences from three different companies, on-track first.
5. `computeGaps` counts practices the student has not met over a cohort of at least 40 postings, widening from early career to the whole track, and from a thin track to all of software engineering, when it must.

Every link is a pure function in `main/ikb/` with a test beside it. `tag.ts` has no Electron in it, so the ingest script and the app share one tagger.

## The interview accounts

`main/interviews/` is a second evidence source under the same rule. `gather` reads LeetCode's interview experience board and Hacker News comments, `sentencesOf` turns accounts into sentences with ids, and `briefInterview` hands the model those and nothing else, with `CitationFilter` dropping any id not in the list. Parsing is separate from fetching: `parseLeetCode` and `parseHn` run on fixtures in `sources.test.ts`, and `gather` runs against a fake fetch. Add a source by adding a parser with a fixture, a fetcher, and a line in the README naming it. Never add one that wants a login.

## Adding a company

1. Add a row to `data/boards.json`: `ats` of greenhouse, lever or ashby, the board token, the display name. The token is the slug in the company's own careers URL.
2. `npm run ingest`. It needs the network, takes a minute or two, prints one line per board and a `skipped:` line for any that failed. A board that fails is left out, never half in.
3. Commit `data/ikb.json` with the row. It ships built and the app reads it from disk at runtime, so the app needs no rebuild.

Done when the ingest summary counts the new company and `npm test` still passes. `ikb.test.ts` runs against the real file.

## Adding a tool or practice

1. Add `{ "term": ..., "aliases": [...] }` to `data/tools.json` or `data/practices.json`. The canonical `term` is what cards and gaps display; aliases are what postings write. Matching is case-insensitive unless the word is in `AMBIGUOUS` in `tag.ts`, where a short word that is also English, "Go" or "R", counts only beside a list separator.
2. Add a case to `tag.test.ts`: a sentence that should tag and a near miss that should not.
3. `npm run ingest`, because tags are written into `ikb.json` at ingest, not computed when the app loads.

Done when the new term has hits, checked with `ikb.byTag.get(term)` in a test, and the near miss stays untagged.

## When a card is wrong

- **No evidence on a card.** The model's terms did not resolve. `LILO_DEBUG_LLM=1` shows what it proposed against the menu it was given. The fix is usually an alias, not a prompt.
- **The wrong company, or one company twice.** `evidenceFor` scoring, and its one-per-company rule.
- **A gap the student already met.** `heardTerms` on the profile is what suppresses it.
- **A percentage off a handful of postings.** The cohort widened. `computeGaps` returns which one it used and the companion says so.

`classifyRole` in `tag.ts` answers null for any title that is not a software engineering role, and the ingest drops those, so a company's sales and legal postings never reach the base. The track rules put the kind of code someone writes ahead of the domain it runs in, and match prefixes with no trailing boundary where the comment says why. Keep both when adding a track.
