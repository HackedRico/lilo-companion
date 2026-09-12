# Lilo

A companion for the computer science student who wants the job.

Lilo sits in the corner of your screen while you do the hard parts of getting
there, and it stays on your side. Hand it a lecture and it shows you where that
idea turns up in real software engineering postings, so "I will never use
this" stops being true. Ask it for work and a coworker sends you a vague
request, the way one lands on the engineer on a team, and a senior reviews
what you send back. Open a problem on LeetCode and it sits beside you, says
what it sees, and helps only as much as you let it, so the effort stays yours.

It cheers when you get there. It does not do the work for you.

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

**You** is the profile: what you study, which kind of engineering you are
aiming at, and what the companion has already read back to you. That last list
is what stops the recap offering something as a gap when you have already met
it.

**The model** is an endpoint URL, a key and two model names, all yours to
type. The URL is wherever the model is: Featherless, OpenRouter, Groq, Ollama,
LM Studio, your own vLLM, or api.anthropic.com. How it speaks is worked out
from the address, so there is no vendor setting and no protocol setting
anywhere in the code. The model list is read from whatever endpoint you point at, and
"Test it" makes one real call and says what came back.

Keys are held in the OS keychain, Keychain on macOS and DPAPI on Windows, and
never reach the renderer, which only ever learns whether a key is set and its
last four characters. An address on this machine is recognised as local and
stops asking for one. Anything left blank falls through to `.env`, so a
developer checkout needs no clicking.

## Lectures

A lecture is a file you hand over: a transcript, captions or your own notes,
one line per thing said. Pick one from the menu bar mark under "Upload a
lecture", press the button at the top of the panel, or paste notes into the
composer. It is read whole, and the companion says what is being taught and
where it turns up at work. Nothing is bundled, so the first one is yours to
bring.

To start with a lecture already read, put `LECTURE_FILE=path/to/lecture.txt`
in `.env`, or pass `--lecture path/to/lecture.txt` to a packaged build.

## On LeetCode

Lilo reads the editor on leetcode.com through a small Chrome extension you
load once. Open Settings, the LeetCode tab, and press "Set up Chrome": it
writes the file Chrome needs, then you open chrome://extensions, turn on
Developer mode, press Load unpacked and pick the folder the tab shows. The
tab says Connected once a problem is open.

How much help you get is a ceiling you pick on the same tab. Hands off says
what it sees and cheers, and gives you one question to think about when asked.
Coach names the idea and shows where your own code goes wrong. Tutor walks you
through the steps, and hands over code only when you ask for it outright.
Whatever the level, the companion says what it sees first, in plain words, and
a hint it volunteers is earned: one rung higher a minute at a time, and only
after your code changed. Every hint says which rung it reached.

Every session is written to a file under the app's data folder, one event per
line, and played back with `--work-recording path/to/session.jsonl` or
`WORK_RECORDING=` in `.env`, so the companion's manners can be tuned with no
browser open.

## The evidence base

`data/ikb.json` is what the companion proves claims against: software
engineering postings and the sentences inside them, tagged with the tools and
practices in `data/tools.json` and `data/practices.json`. It ships built, from
the 30 public ATS boards listed in `data/boards.json`. Only a posting whose
title is a software engineering role is kept; sales, product, design and the
rest of a board are dropped at ingest.

```bash
npm run ingest
```

These are the same endpoints the companies' own job pages call. No auth, no
scraping. Add a company by adding a row to `boards.json`. If the file is
missing the app still starts, with nothing to prove anything with.

## Checks

| | |
|---|---|
| `npm test` | tagging, search, gaps, the watcher, citations, the tray mark, the ladder, the bridge, the whole loop against a scripted model |
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
| `main/leetcode/` | the LeetCode practice: state, ladder, coach, bridge, recordings |
| `main/host.ts` | the native messaging host Chrome runs |
| `extension/` | the Chrome extension, loaded unpacked |
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

## Three rules the code keeps

The model translates, role-plays and explains; real postings prove. The
coworker is only ever told what the student has already uncovered. And a
LeetCode hint is checked against the level you set and against your own code
before it is said.
[docs/architecture.md](docs/architecture.md) says how each is enforced and why
the rest of the app is shaped the way it is.

[AGENTS.md](AGENTS.md) is the working agreement for anyone changing the code,
person or agent: the layout, the conventions, and what has to be true on both
platforms before a commit.
