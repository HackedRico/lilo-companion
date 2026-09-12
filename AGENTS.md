# Working on Lilo

Lilo is an Electron companion that listens to a lecture, says where the concept
turns up in real job postings, and hands the student a vague request from a
coworker to answer. It ships on macOS and Windows, and every change has to hold
on both.

## Layout

- `main/` is the Electron main process: the session loop, the window, the tray,
  settings, the evidence base, and every model call.
- `preload/` is the one door between main and a renderer. It exposes exactly
  the channels named in `shared/api.ts`.
- `renderer/` is React, sandboxed, with no Node in it. Two pages: `index.html`
  is the orb and the panel, `settings.html` is the preferences window.
- `shared/` is types, prompts, schemas and layout maths. Both sides import it;
  it imports neither.
- `data/` is the evidence base and the lists that build it. `scripts/` builds
  it. `docs/` holds the reasoning.

Read [docs/architecture.md](docs/architecture.md) before changing the loop in
`main/session.ts`, the window in `main/panel.ts`, or a prompt: it says why each
is shaped the way it is. Read [docs/platforms.md](docs/platforms.md) before
touching the window, the tray, keys, audio or packaging: it says what differs
between macOS and Windows and which of those differences are load-bearing.
Read [docs/character.md](docs/character.md) before changing the orb, its
moods or the tray mark: it holds the geometry and the numbers.

## Two rules the code keeps

**The model translates, role-plays and explains. Real postings prove.** A term
the model returns survives only where `resolveTerms` finds it in the base, and
a citation survives only where the retriever returned it
(`main/chat/citations.ts`). Every claim about industry traces to a sentence
with a posting URL.

**The coworker knows only what the student has uncovered.** `revealFacts`
decides which hidden facts a question reaches, and the persona prompt is built
from those alone (`main/scenario/stakeholder.ts`). Hidden facts and the rubric
stay in main; a thread item carries the visible message.

## Both platforms

- Guard macOS-only window and tray options behind
  `process.platform === 'darwin'`. Which options those are is in platforms.md.
- Build paths with `node:path` in main. The renderer asks main for anything
  that touches the filesystem.
- Write shell instructions in a form that works in cmd and PowerShell as well
  as zsh: pass values as flags, or say to put them in `.env`.
- A Mac can verify typecheck, tests, the build and the running app. Only CI or
  a Windows machine shows the tray mark on a light taskbar, the panel taking
  focus when clicked, and transparency with hardware acceleration off. Say
  which of these you checked.

## Conventions

- Relative imports carry explicit `.ts` and `.tsx` extensions, and constructors
  assign their fields explicitly rather than through parameter properties.
  Both exist so `node --test` loads any module directly, with no build step.
- A test sits beside its module as `name.test.ts`. The whole loop runs against a
  scripted model in `main/session.test.ts`; a prompt or schema change gets a
  case there before a real model sees it.
- Every model reply is parsed against a zod schema in `shared/schemas.ts`, and
  the prompt in `shared/prompts.ts` states that schema in words. Change the two
  together.
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

README.md covers setup. Development switches: `--replay <file>` plays a saved
transcript with no microphone, `LILO_OPEN_PREFS=1` opens the preferences
window on launch, and `LILO_DEBUG_LLM=1` prints every raw model reply. On
Windows, set the variables in `.env` or with `$env:NAME = "1"` in PowerShell.
