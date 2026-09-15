# Lilo

**A desktop companion for the software engineering student who wants the job.**

> [!IMPORTANT]
> **Winner, LILO Hackathon 2026.** Track 01, LILO Behind the Scenes: DSA
> practice and interviewing.

## The problem

> **"I will never use this in my career."**

Every student has said it, halfway through a lecture. That is the moment the
motivation goes: the slides keep moving, the concept stays abstract, and the
job it was all supposed to lead to feels further away, not closer. The gap
between the classroom and that job is real, and the student is left to close
it alone.

An AI is the obvious tool for closing it: it can read the lecture and it can
read the postings. The two ways it goes wrong are well known. It invents the
link, and the student believes it. Or it does the work, and the student
learns nothing.

## What Lilo does

Lilo is a companion that stays with the student through all of it, from that
lecture to the LeetCode grind to the interview to the offer.

- **Hand it a lecture.** It names the concept, says what industry calls the
  same thing, and quotes a real job posting to prove it, with the URL behind
  the quote.
- **Open a problem on LeetCode.** It sits beside you, reads your editor, and
  helps only up to a ceiling you set, so the effort stays yours.
- **Ask about an interview.** It reads what people posted first-hand about a
  company, with a citation on every claim.

It cheers when you get there. It never does the work for you. It never
invents a source, and it never gives more help than you asked for: both are
checked in code after the model answers, not asked of the model.

It runs on macOS and Windows from one codebase, with a model you choose,
hosted or on your own machine.

## How it works

![How Lilo is built: the student, the companion, its three practices and two rules, and what it draws on](docs/architecture.svg)

The drawing is the shape. What follows is what happens along each path.

### When you hand it a lecture

1. The file is read whole, and the model is asked one thing: what is being
   taught here? At most three concepts come back.
2. For each concept, Lilo looks in the evidence base for the terms postings
   use nearest to it, and hands that shortlist to the model with one
   instruction: copy one exactly.
3. Anything the model says that is not in the evidence base is thrown away.
   The one exception is a term the quoted postings themselves use, word for
   word. If nothing survives, Lilo says postings do not ask for this, rather
   than stretching.
4. What survives becomes a card: sentences from three different companies,
   quoted as written, each with the URL of the posting it came from.
5. At the end of a session, a recap: what you met, and what postings for your
   track ask for that you have not.

### When you are stuck on LeetCode

1. A Chrome extension reports the problem, your code, and every run with its
   verdict. Every report is checked against a fixed shape before anything
   reads it.
2. Lilo says what it sees first, in plain words, with no model involved: the
   problem, how many lines you have, what the last run said.
3. A hint it offers on its own is earned: one grade higher at a time, no more
   than once a minute, and only after your code has changed. Ask, and it
   answers at the level you set.
4. The model is asked once, for a hint that carries its grade. A gate then
   reads the hint, decides which grade it really reaches, and refuses it if
   that is above your level, or if it names a line or a variable that is not
   in your code.
5. A refused hint is asked for once more under a stricter instruction, then
   dropped. Only then is a word said, and any line it names is marked in your
   editor.
6. Ask to be walked through it, and the hint comes with a dry run: the
   pointers on the array, the values that change, one row per step, drawn in
   the thread for you to step through at your own pace. The same ceiling
   applies to the picture as to the words.

### When you ask about a company's interview

1. Lilo fetches what people posted first-hand in the last year, on LeetCode's
   interview board and on Hacker News. Nothing else is read. With nothing to
   read, no model is called, and it says so.
2. The accounts are split into numbered sentences, and the model is given
   those and nothing else.
3. Every claim in the reply has to point at one of those sentences. A claim
   that does not is dropped where it stands. How old the newest account is
   comes from the dates, not from the model.

On every path:

- Every model call waits in one queue, and every structured reply is checked
  against a schema before it is believed.
- Nothing you ask for is dropped because the app is busy.

## Getting started

### Install and run

```bash
npm install
node node_modules/electron/install.js
npm run dev
```

- Node 22.18 or newer.
- The second line fetches the Electron binary, because npm 11 skips install
  scripts.
- The same three lines work in PowerShell and cmd.
- Nothing has to be configured before the app starts.

What you see:

- An orb, bottom right, and a mark in the menu bar on macOS or the
  notification area on Windows. No Dock tile, no taskbar button.
- Cmd+Shift+Y on macOS, Ctrl+Shift+Y on Windows, opens and closes the panel.
  Escape closes it.

### Choose a model

Open the panel and press the gear.

- A model is an address, a key and two model names. You type all three.
- The protocol is decided from the address: api.anthropic.com gets the
  messages API, everything else gets the OpenAI chat API, which every hosted
  service, gateway and local server speaks.
- The model list is read from the endpoint. "Test it" makes one real call and
  says what came back.
- Keys are sealed with the OS keychain, Keychain on macOS and DPAPI on
  Windows. The window only ever learns whether a key is set and its last four
  characters.
- Anything left blank falls through to `.env`, so a developer checkout needs
  no clicking.
- The quick model reads lectures and answers questions. The careful one
  coaches on LeetCode.

To run with no network at all, pull a model into Ollama and give Lilo the
address. A local address is recognised and asks for no key.

```bash
ollama pull qwen2.5-coder:7b
```

```
LLM_BASE_URL=http://localhost:11434
MODEL_FAST=qwen2.5-coder:7b
MODEL_STRONG=qwen2.5-coder:7b
```

### Connect LeetCode

1. Open Settings, the LeetCode tab, and press "Set up Chrome". It writes the
   file Chrome needs.
2. Open chrome://extensions, turn on Developer mode, press Load unpacked and
   pick the folder the tab shows.
3. Open a problem. The tab says Connected.

Then pick how much help you want:

| Level | Volunteers up to | Answers up to |
|---|---|---|
| Hands off | what it sees | a question to think about |
| Coach | the idea by name | where your own code goes wrong |
| Tutor | the steps | the answer, and only when asked outright |

A hint that names lines marks them in the editor, as the companion's, and
clears them on your next edit. Nothing else is ever written to the page.

### Lectures and voice

- A lecture is a `.txt`, `.md`, `.vtt`, `.pdf` or `.pptx`.
- Drag it onto the orb or the panel, pick it from the menu bar mark, or paste
  notes into the composer.
- `--lecture path`, or `LECTURE_FILE=` in `.env`, starts with one already
  read.
- Voice mode is the mic beside "Upload a lecture". Cmd+Shift+M on macOS,
  Ctrl+Shift+M on Windows, records. The words land in the composer to be read
  before they are sent.
- Speech goes where the model is when that address transcribes, as OpenAI's
  and Groq's do. A whisper server on this machine keeps it local:

```
VOICE_BASE_URL=http://localhost:8000
VOICE_MODEL=Systran/faster-whisper-small.en
```

### Interviews

- Ask in your own words: "I have an onsite with Coinbase".
- What was read is kept for a day, so the second ask is instant and offline.
- Glassdoor, Blind and Reddit are not read. They want a login or refuse the
  request.

## Tech stack

One codebase in TypeScript, from the window to the Chrome host. The versions
are the ones in `package.json`.

| Layer | What it is |
|---|---|
| Renderer | React 19, TypeScript 5.9, Tailwind 4 and zustand 5. A sandboxed page with no Node in it. The orb and the menu bar mark are drawn in code, so there are no image assets to keep in step. |
| Preload | Electron's `contextBridge`, exposing exactly the channels named in `shared/api.ts`. Every value from a renderer is checked in main before it reaches a window. |
| Main | Electron 44 on Node 22, the only process that reaches the disk, the network or your keys. The `openai` and `@anthropic-ai/sdk` clients under one queue, one backoff and a zod 4 schema over every structured reply. MiniSearch 7 over the tagged sentences. `unpdf` and `jszip` read PDFs and PowerPoint. `electron-store` over `dotenv` for settings, with keys sealed by `safeStorage`. |
| Chrome | A Manifest V3 extension, three plain files loaded unpacked. It reads the LeetCode editor and nothing else. A native messaging host, Lilo's own binary run as plain Node, carries its events to the app over a local socket. |
| Model | Any OpenAI-compatible endpoint, hosted or on this machine, or Anthropic's own. The protocol is decided from the address. Speech goes to any whisper-style endpoint as 16 kHz WAV. |
| Evidence | `data/ikb.json`: 1,388 software engineering postings from 30 companies, split into 10,737 sentences, each tagged with the tools and practices it mentions. Read from the Greenhouse, Ashby and Lever endpoints the careers pages call, and rebuilt with one command. |
| Sources | LeetCode's interview board and Hacker News for first-hand write-ups. |
| Build and check | `electron-vite` 5 for dev and bundles, `node --test` loading the TypeScript directly, `electron-builder` 26 for a DMG and an NSIS installer, GitHub Actions running typecheck, tests and both packages on every push. |

### Where things are

```
lilo-companion
├── main/              the Electron main process
│   ├── session.ts     the loop: hear, see, lock in, recap
│   ├── pipeline/      lecture to concept to posting terms to evidence
│   ├── ikb/           the evidence base: tagging, search, roles, gaps
│   ├── chat/          the companion's answers, and the citation filter
│   ├── leetcode/      the practice: state, ladder, coach, bridge, recordings
│   ├── interviews/    first-hand accounts: ask, sources, brief, cache
│   ├── llm/           one queue, one schema check, a provider per protocol
│   ├── panel.ts       the window
│   ├── tray.ts        the menu bar mark
│   ├── settings.ts    settings over .env, keys sealed in the keychain
│   ├── voice.ts       speech to words
│   ├── guards.ts      nothing from a renderer reaches a window unchecked
│   └── host.ts        the native messaging host Chrome runs
├── preload/           the one door between main and a renderer
├── renderer/          React, sandboxed, no Node in it
│   ├── bubble/        the orb and its face
│   ├── thread/        the panel: one conversation
│   └── settings/      the preferences window
├── shared/            types, prompts, schemas, layout maths
├── extension/         the Chrome extension: agent, relay, service worker
├── data/              the evidence base, and the lists that build it
├── scripts/           the ingest that rebuilds it
└── docs/              the reasoning
```

## Development

| | |
|---|---|
| `npm test` | 296 tests: tagging, search, gaps, citations, the ladder, the bridge, the tray mark, and the whole loop against a scripted model |
| `npm run typecheck` | main, preload, renderer and the tests |
| `npm run build` | the three bundles under `out/` |
| `npm run package:mac`, `npm run package:win` | installers, which CI also builds on both platforms |
| `npm run ingest` | rebuilds the evidence base from the 30 boards in `data/boards.json` |

- A posting is kept only if its title is a software engineering role. Sales,
  product and design are dropped at ingest. Add a company by adding a row to
  `data/boards.json`.
- Every LeetCode session is written to a file under the app's data folder,
  one event per line. `--work-recording path/to/session.jsonl` plays one back
  with no browser open, which is how the companion's manners are tuned.
- `LILO_DEBUG_LLM=1` prints every model call with its queue wait and its wire
  time. `LILO_OPEN_PREFS=1` opens the preferences window on launch.
- What differs between macOS and Windows sits behind `process.platform`: how
  a floating window takes focus, how the menu bar mark is drawn, where keys
  and the Chrome host manifest live. [docs/platforms.md](docs/platforms.md)
  says exactly where, and which of those a Mac cannot verify.

## Documentation

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | why each part is shaped the way it is, and where the time goes |
| [docs/platforms.md](docs/platforms.md) | macOS against Windows, and which differences are load-bearing |
| [docs/character.md](docs/character.md) | the orb: its geometry, its moods and the menu bar mark |
| [docs/demo-script.md](docs/demo-script.md) | the three minute demo, beat by beat |
| [AGENTS.md](AGENTS.md) | the working agreement for anyone changing the code, person or agent |

## License

Apache 2.0. See [LICENSE](LICENSE).
