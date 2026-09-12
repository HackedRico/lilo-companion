# Lilo

Hear it in class. See it in real jobs. Do it like work.

A floating desktop companion that listens to a lecture, tells you where the
concept turns up at work with evidence from real job postings, then hands you a
vague request from a coworker so you can try it.

It runs on macOS and Windows. The two differ in how a floating window behaves,
how the menu bar mark is drawn and where keys are kept, and
[docs/platforms.md](docs/platforms.md) says exactly where. Everything else is
one codebase with no platform switch in it.

## Running it

```bash
npm install
node node_modules/electron/install.js
npm run dev
```

The second line fetches the Electron binary, because npm 11 skips install
scripts. On Windows, run the same three lines in PowerShell or cmd.

An orb appears bottom right, and a mark appears in the menu bar (macOS) or the
notification area (Windows). There is no Dock tile or taskbar button.
Cmd+Shift+Y on macOS, Ctrl+Shift+Y on Windows, opens and closes the panel;
Escape closes it.

Open the panel and press the gear, or use the menu bar mark, to set a key and
pick models. Nothing needs to be configured before the app starts.

## Settings and profile

**You** is the profile: what you study, what you are aiming at, your courses
and interests, and what the companion has already read back to you. That last
list is what stops the recap offering something as a gap when you have already
met it.

**The model** is a protocol, an address, a key and two model names, all yours
to type. The protocol is how the endpoint speaks, OpenAI chat completions or
Anthropic messages, and the address is where it is: a hosted service, a
gateway, or a server on this machine. There is no vendor setting anywhere in
the code. The model list is read from whatever endpoint you point at, and
"Test it" makes one real call and says what came back.

Keys are held in the OS keychain, Keychain on macOS and DPAPI on Windows, and
never reach the renderer, which only ever learns whether a key is set and its
last four characters. An address on this machine is recognised as local and
stops asking for one. Anything left blank falls through to `.env`, so a
developer checkout needs no clicking.

## Listening without a microphone

A saved lecture is fed back in as if it were being spoken, so the loop runs
with no room and no network in it. Pick one from the menu bar mark under "Play a
saved lecture". Any transcript works: one line per thing said, and a line
arrives every few seconds. Nothing is bundled, so the first one is yours to
bring.

To start with a lecture already playing, put `REPLAY_FILE=path/to/lecture.txt`
in `.env`, or pass `--replay path/to/lecture.txt` to a packaged build.

## The evidence base

`data/ikb.json` is what the companion proves claims against: postings and the
sentences inside them, tagged with the tools and practices in `data/tools.json`
and `data/practices.json`. It ships built, from the 30 public ATS boards listed
in `data/boards.json`.

```bash
npm run ingest
```

These are the same endpoints the companies' own job pages call. No auth, no
scraping. Add a company by adding a row to `boards.json`. If the file is
missing the app still starts, with nothing to prove anything with.

## Checks

| | |
|---|---|
| `npm test` | tagging, search, gaps, the watcher, citations, the tray mark, the whole loop against a scripted model |
| `npm run typecheck` | main, preload, renderer and the tests |
| `npm run build` | the three bundles under `out/` |
| `npm run package:mac`, `npm run package:win` | installers, which CI also builds on both platforms |

All four run on either OS. What a Mac cannot show you is the tray mark on a
light Windows taskbar, the panel taking focus when clicked, and transparency
with hardware acceleration off; those want a Windows machine, or the installer
CI builds.

Two `.env` switches help while working: `LILO_OPEN_PREFS=1` opens the
preferences window on launch, and `LILO_DEBUG_LLM=1` prints every raw model
reply.

## Where things are

| | |
|---|---|
| `main/session.ts` | the loop: hear, see, do, review, lock in, recap |
| `main/scenario/stakeholder.ts` | the coworker, and why they cannot leak |
| `main/ikb/` | job postings: tagging, search, gap statistics |
| `main/pipeline/` | transcript to concept to posting terms to evidence |
| `main/panel.ts` | the window: placement, dragging, click-through |
| `main/settings.ts` | what you chose, layered over .env, keys sealed |
| `main/llm/` | the service layer: one queue and one schema check over a provider per protocol |
| `main/guards.ts` | nothing from a renderer reaches a window unchecked |
| `preload/index.ts` | the one door between main and a renderer |
| `renderer/bubble/` | the orb, its face, and the whisper |
| `renderer/thread/` | the one conversation everything lands in |
| `renderer/settings/` | the preferences window |
| `shared/prompts.ts` | every prompt, and the companion's voice |
| `scripts/ingest-ikb.ts` | the job board ingest |

## Two rules the code keeps

The model translates, role-plays and explains; real postings prove. And the
coworker is only ever told what the student has already uncovered.
[docs/architecture.md](docs/architecture.md) says how each is enforced and why
the rest of the app is shaped the way it is.

[AGENTS.md](AGENTS.md) is the working agreement for anyone changing the code,
person or agent: the layout, the conventions, and what has to be true on both
platforms before a commit.
