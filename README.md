# Lilo

Hear it in class. See it in real jobs. Do it like work.

A floating desktop companion that listens to a lecture, tells you where the
concept turns up at work with evidence from real job postings, then hands you a
vague request from a coworker so you can try it.

## Running it

```bash
npm install
node node_modules/electron/install.js   # npm 11 blocks install scripts
npm run dev
```

An orb appears bottom right with a menu bar item next to the clock. There is no
Dock tile. Cmd/Ctrl+Shift+Y opens and closes the panel, Escape closes it.

Open the panel and press the gear, or use the menu bar item, to set a key and
pick models. Nothing needs to be configured before the app starts.

## Settings and profile

One window, one page.

**You** is the profile: what you study, what you are aiming at, your courses and
interests, and what the companion has already read back to you. That last list
is what stops the recap offering something as a gap when you have already met it.

**The model** is an address, a key and two model names. There is no provider
setting anywhere in the code: Featherless, Ollama, LM Studio, OpenAI, OpenRouter,
Groq and your own vLLM differ only in those four values, so the buttons along the
top are shortcuts that fill in an address, not modes. The model list is read from
whatever endpoint you point at, and the handful confirmed to work end to end are
marked. "Test it" makes one real call and says what came back.

Keys are held in the OS keychain and never reach the renderer, which only ever
learns whether a key is set and its last four characters. An address on this
machine is recognised as local and stops asking for one. Anything left blank
falls through to `.env`, so a developer checkout needs no clicking.
`LILO_OPEN_PREFS=1 npm run dev` opens the window on launch while working on it.

## Listening without a microphone

A saved lecture is fed back in as if it were being spoken, so the loop runs with
no room and no network in it. Pick one from the menu bar item under "Play a
saved lecture", or start with a file already chosen:

```bash
REPLAY_FILE=path/to/lecture.txt npm run dev
```

Any transcript works. One line per thing said, and a line arrives every few
seconds. Nothing is bundled, so the first one is yours to bring.

## The evidence base

`data/ikb.json` is what the companion proves claims against: postings and the
sentences inside them, tagged with the tools and practices in `data/tools.json`
and `data/practices.json`. It ships built, from the 30 public ATS boards listed
in `data/boards.json`.

```bash
npm run ingest   # rebuild it from those boards
```

These are the same endpoints the companies' own job pages call. No auth, no
scraping. Add a company by adding a row to `boards.json`. If the file is missing
the app still starts, with nothing to prove anything with.

## Checks

| | |
|---|---|
| `npm test` | tagging, search, gaps, the watcher, citations, the whole loop against a scripted model |
| `npm run typecheck` | all three projects |
| `npm run package:mac` / `package:win` | installers, also built by CI on both platforms |

`LILO_DEBUG_LLM=1` prints every raw model reply.

## Where things are

| | |
|---|---|
| `src/main/session.ts` | the loop: hear, see, do, review, lock in, recap |
| `src/main/scenario/stakeholder.ts` | the coworker, and why they cannot leak |
| `src/main/ikb/` | job postings: tagging, search, gap statistics |
| `src/main/pipeline/` | transcript to concept to posting terms to evidence |
| `src/main/panel.ts` | the window: placement, dragging, click-through |
| `src/renderer/src/bubble/` | the orb and the whisper |
| `src/renderer/src/thread/` | the one conversation everything lands in |
| `src/renderer/src/settings/` | the preferences window |
| `src/main/settings.ts` | what you chose, layered over .env, keys sealed |
| `src/main/guards.ts` | nothing from a renderer reaches a window unchecked |
| `src/shared/prompts.ts` | every prompt, and the companion's voice |
| `scripts/ingest-ikb.ts` | the job board ingest |

## Two rules the code keeps

**The LLM translates, role-plays and explains. Real postings prove.** A term the
model invents is dropped before it reaches a card. A citation the retriever did
not return is stripped from the answer.

**The coworker is only ever told what the student has already uncovered.** Each
question is gated by a separate call that decides which hidden facts it reaches;
the persona is then written with only those. It cannot leak what it never had.

[docs/architecture.md](docs/architecture.md) is how the pieces fit and why.
[docs/platforms.md](docs/platforms.md) is what differs between macOS and Windows.
