# Working on Lilo

Lilo is an Electron companion for software engineering students, there to
keep them going toward the job. It reads a lecture the student hands it and
says where the concept turns up in real software engineering postings with
verifiable evidence. And it sits beside them on LeetCode, with help at a
level they set, so the effort stays theirs. It ships on macOS and Windows, and
every change has to hold on both.

## Layout

- `main/` is the Electron main process: the session loop, the window, the tray,
  settings, the evidence base, and every model call. `main/leetcode/` is the
  LeetCode practice, and `main/host.ts` is the native messaging host Chrome
  runs, bundled on its own with no Electron in it.
- `main/interviews/` reads first-hand interview accounts from public boards
  and briefs the student with a citation on every claim.
- `extension/` is the Chrome extension, three plain files loaded unpacked.
- `preload/` is the one door between main and a renderer. It exposes exactly
  the channels named in `shared/api.ts`.
- `renderer/` is React, sandboxed, with no Node in it. Two pages: `index.html`
  is the orb and the panel, `settings.html` is the preferences window.
- `shared/` is types, prompts, schemas and layout maths. Both sides import it;
  it imports neither.
- `data/` is the evidence base and the lists that build it. `scripts/` builds
  it. `docs/` holds the reasoning.

Read [docs/architecture.md](docs/architecture.md) before changing the loop in
`main/session.ts`, the practice in `main/leetcode/`, the window in
`main/panel.ts`, or a prompt: it says why each is shaped the way it is. Read [docs/platforms.md](docs/platforms.md) before
touching the window, the tray, keys, paths or packaging: it says what differs
between macOS and Windows and which of those differences are load-bearing.
Read [docs/character.md](docs/character.md) before changing the orb, its
moods or the tray mark: it holds the geometry and the numbers.

## One audience

Lilo is for software engineering students and nobody else. The evidence base
holds software engineering postings only: `classifyRole` answers null for any
other title and the ingest drops it. The role families are engineering tracks,
every prompt says who the student is, and copy, placeholders and worked
examples name software engineering rather than a stand-in from another field.

## Two rules the code keeps

**The model translates and explains. Real postings prove.** A term
the model returns survives only where `resolveTerms` finds it in the base, and
a citation survives only where the retriever returned it
(`main/chat/citations.ts`). Every claim about industry traces to a sentence
with a posting URL. An interview brief lives under the same rule: it cites
only sentences from accounts fetched this turn (`main/interviews/`).

**The ladder is enforced by code.** A LeetCode hint carries a rung, and
`gate` in `main/leetcode/ladder.ts` checks the rung against the tier's ceiling
and every line and name against the student's code before it is said. The
model is told the ceiling and never trusted with it. The state is said first,
from `describe`, with no model in it.

## Both platforms

- Guard macOS-only window and tray options behind
  `process.platform === 'darwin'`. Which options those are is in platforms.md.
- Build paths with `node:path` in main. The renderer asks main for anything
  that touches the filesystem. Where a path is for the other platform, as in
  `main/leetcode/connect.ts`, use that platform's own `posix` or `win32`.
- The Chrome host manifest, launcher and socket differ per platform.
  `connect.ts` and `bridge.ts` hold both branches, and platforms.md says which
  of them a Mac cannot try.
- Write shell instructions in a form that works in cmd and PowerShell as well
  as zsh: pass values as flags, or say to put them in `.env`.
- A Mac can verify typecheck, tests, the build and the running app. Only CI or
  a Windows machine shows the tray mark on a light taskbar, the panel taking
  focus when clicked, and transparency with hardware acceleration off. Say
  which of these you checked.

## Latency

`docs/architecture.md` under "Where the time goes" holds the measured costs and
the rules that came out of them: JSON mode only after an unparseable reply,
prose on the quick lane and judgement on the careful one, and nothing the
student asks for dropped on a busy flag. `LILO_DEBUG_LLM=1` prints the queue
wait and the wire time of every call. Measure before changing any of it.

## Conventions

- Relative imports carry explicit `.ts` and `.tsx` extensions, and constructors
  assign their fields explicitly rather than through parameter properties.
  Both exist so `node --test` loads any module directly, with no build step.
- A test sits beside its module as `name.test.ts`. The whole loop runs against a
  scripted model in `main/session.test.ts`; a prompt or schema change gets a
  case there before a real model sees it.
- Every model reply is parsed against a zod schema in `shared/schemas.ts`, and
  the prompt in `shared/prompts.ts` states that schema in words. Change the two
  together. An event from the page is parsed against `workEvent` in
  `shared/leetcode.ts` before anything sees it.
- A new IPC channel is a name in `shared/api.ts`, a line in
  `preload/index.ts`, a handler in `main/index.ts`, and a guard from
  `main/guards.ts` on anything that reaches a window.
- Keys are sealed with `safeStorage` in main. The renderer learns whether a key
  is set and its last four characters.
- `data/ikb.json` holds postings and sentences. `npm run ingest` rebuilds it
  from `data/boards.json`.
- Comments say why. The code says what.

## Before a commit

`npm run typecheck` and `npm test` both green, and `npm run build` when a
config, an entry file or anything under `preload/` changed. Conventional
Commits, lowercase, present tense: `feat(orb): ...`, `fix(panel): ...`. The
message names the change.

## Running it

README.md covers setup. Development switches: `--lecture <file>` reads a saved
lecture on launch, `--work-recording <file>` plays a recorded LeetCode session
with no browser, `LILO_OPEN_PREFS=1` opens the preferences
window on launch, and `LILO_DEBUG_LLM=1` prints every raw model reply. On
Windows, set the variables in `.env` or with `$env:NAME = "1"` in PowerShell.
