---
name: leetcode-hook
description: Changes what the companion sees on LeetCode and how it helps: the Chrome extension, the native host, the event vocabulary, the ladder gate and recordings. Use when editing extension/, main/leetcode/, main/host.ts or shared/leetcode.ts, when a hint climbs above the tier, when a mark lands on the wrong line, or when the LeetCode tab says Not connected.
---

# LeetCode hook

The companion sees the student's work on leetcode.com through three layers, and only the bottom one knows about Chrome. `docs/architecture.md` under "The LeetCode practice" is the reasoning; this is how to change it without breaking the ladder.

## The layers

1. **Transport.** `extension/background.js` speaks to a native messaging host named `com.lilo.companion`. The host is `main/host.ts`, the app's binary run as plain Node, relaying Chrome's framed messages to a local socket that `main/leetcode/bridge.ts` listens on. `connect.ts` writes the manifest and the launcher where each platform wants them.
2. **In-page agent.** `extension/agent.js` runs in the page's own world. It reads Monaco's model, fetches the problem through the site's GraphQL with the student's own session, and wraps `fetch` to see run and submit verdicts. `relay.js` in the isolated world carries events out and marks in.
3. **Event vocabulary.** `workEvent` in `shared/leetcode.ts`. Everything above it is platform-free: `state.ts` folds, `ladder.ts` gates, `coach.ts` asks, `practice.ts` decides when to speak, `recording.ts` writes and replays.

## Changing what is said

- The floor is `describe` in `state.ts`. It has no model in it and is said at every tier; keep it that way.
- A hint comes from `coachHint` in `shared/prompts.ts` and is parsed by `hintOut`. `gate` is what decides whether it is said. A change to the prompt gets a case in `practice.test.ts`, where `ScriptedCoach` answers from a queue and the test asserts what was said, marked and withheld.
- Proactive timing lives in `nextRung`. Its constants are the manners: a minute between climbs, and only after an edit. Change them there, with the test beside them.

## Trying it

- With no Chrome: a recording. The `run-lilo` skill has the format and the switch. A recording replays through the whole practice, so most changes can be seen this way.
- With Chrome: Settings, LeetCode, Set up Chrome, then load `extension/` unpacked at chrome://extensions. After changing a file under `extension/`, press the reload arrow on the card there and reload the problem tab. After changing the manifest or the launcher, restart Chrome, which reads native host manifests at start.
- The tab says Not connected until an event has arrived. Open a problem, edit a line. If it stays that way: the manifest path from `manifestPlace` has to exist, the launcher has to be executable, and the dev log says `[lilo] no bridge for chrome` when the socket could not be bound.

## What not to do

- Never let the extension write to the page beyond a mark. The whole channel back is `{ mark: { lines } }`.
- Never move the ceiling check into the prompt. The gate is the rule; the prompt is a request.
- Never send the code anywhere but the configured model. The recording is local and holds the code; say so wherever a recording is offered.

Done when the practice tests pass, a recording replays cleanly, and the commit says whether the live page was tried and on which OS.
