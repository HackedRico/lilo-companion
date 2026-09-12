# How it fits together

The shape of the app, and the reasoning behind the parts that are not obvious
from reading them.

## The loop

`main/session.ts` holds one loop and every state it can be in.

**Hear.** A lecture arrives whole: a transcript or captions uploaded from the
tray or the panel, or notes pasted into the composer. There is no microphone.
One call over what arrived names at most three concepts.

**See.** A concept is translated into what postings call the same thing. The
model is not asked to guess: the terms that appear in postings nearest the
concept are retrieved first and handed over, and it is told to copy one exactly.
Anything it returns that the retriever cannot find is dropped. What survives
becomes a card with three sentences quoted from three different companies.

**Lock in.** A concept can be watched for future lectures. `watch.ts` looks
for those exact words on every line of the next lecture that arrives, and turns
the orb alert when it finds them.

**Recap.** What the student met, and what the postings for their track ask
for that they have not.

## Two rules

**The LLM translates and explains. Real postings prove.** Every
claim about industry traces to a sentence in `data/ikb.json`, and every sentence
traces to a posting with a URL. `citations.ts` strips any `[S:id]` the retriever
did not return, so a model that invents a citation loses it rather than the
student believing it.

**The ladder is enforced by code.** A hint carries a rung, 0 to 5, by how much
of the answer it gives away. The tier the student picks is a ceiling on that
ladder, and `gate` in `main/leetcode/ladder.ts` checks the rung against the ceiling
and every line and name against the student's code before it is said. The
model is told the ceiling and never trusted with it.

## The evidence base

`ingest-ikb.ts` pulls public ATS endpoints, strips boilerplate, splits
requirements into sentences and tags each one against the tool and practice
vocabularies. Postings get a track and a seniority from their title, and a
title that is not a software engineering role is dropped there, so nothing
downstream has to filter sales or legal back out.

Retrieval is exact where it can be and fuzzy where it has to be. `byTag` is the
exact index, `MiniSearch` covers free text and loose phrasing, and a term only
survives if the index has hits for it.

Gap percentages need a cohort big enough to quote. Below 40 postings the cohort
widens from early career on the track to the whole track, and from a thin track
to all of software engineering, and `computeGaps` returns which cohort it used,
so the companion can say so.

A tagger rule reads `data scien\w*` rather than `data scien\b`, because a word
boundary after a prefix can never match the letter that follows it.

## The LeetCode practice

A second practice beside the lecture, in the same thread. A Chrome extension
reads the editor on leetcode.com and reports what it sees as events: a problem
opened or closed, the code changed, a run is pending, an outcome arrived,
attention changed, and what the student asked of the companion. Every event is
validated in `shared/leetcode.ts` on the way in, folded into one state in
`main/leetcode/state.ts`, and written to a daily recording that
`--work-recording` plays back with no browser present. Everything above the
extension is platform-free and tuned from recordings, never from live sessions.

**State before advice.** `describe` reads the state back in words that need no
model: the problem, how many lines, when they last changed, what the last run
said. That is the floor, the same at every tier, and it is what the companion
says on opening and after every run.

**The ladder is enforced by code.** A hint carries a rung, 0 to 5, by how much
of the answer it gives away. The tier the student picks is a ceiling on that
ladder, two of them: what may be volunteered, and what may be answered when
asked. `coach` asks the model once; `gate` checks the rung against the ceiling
and every line number and name against the code; a reply that fails is asked
once more under a stricter instruction and then withheld with an honest line,
or dropped. The model is told the ceiling and never trusted with it.

**Climb on effort.** `nextRung` lets a volunteered hint rise one rung at a
time, no oftener than a minute, and only after the code changed since the last
one. Nothing is volunteered into a run, on top of an accepted answer, during
quiet, or while the tab is not in front.

**One channel back.** A hint that names lines marks them in the editor, marked
as the companion's and cleared on the next edit. Nothing else is ever written
to the page.

The extension is three files under `extension/`: an agent in the page's own
world that reads the editor's model rather than the screen and watches the
site's own network calls for verdicts, a relay in the isolated world that can
reach `chrome.runtime`, and a service worker that speaks to the native host.
The host is the app's own binary run as plain Node on `main/host.ts`, relaying
Chrome's framed messages to the running app over a local socket in
`main/leetcode/bridge.ts`. [platforms.md](platforms.md) says where each
platform keeps the manifest.

## The window

The panel is transparent, frameless and always on top, and it must not take the
lecture out of front when it opens. On macOS that is `type: 'panel'`, which
applies `NSWindowStyleMaskNonactivatingPanel`, plus `app.dock.hide()` to make
the app an accessory. See [platforms.md](platforms.md) for what Windows does
instead.

The window is bigger than what it draws, by the room the orb needs to breathe.
That padding would otherwise eat clicks meant for the app underneath, so the
renderer hit-tests the pointer and toggles `setIgnoreMouseEvents`. It starts
solid and the first mouse move decides, so the orb is never dead on arrival, and
the menu bar item has a switch that turns the whole behaviour off.

The native shadow is off permanently: a transparent window's shadow is
recomputed from the alpha mask every frame, so the panel draws its own in CSS.

macOS routes Cmd C and Cmd V through the application menu, and this app has
none, because Escape and Cmd W have to reach the renderer. The editing
shortcuts are bridged by hand in `index.ts`.

Nothing from a renderer reaches a window unchecked. Electron throws on a
coordinate it cannot convert, so a malformed drag point would take the main
process down with it. Points and text pass through `guards.ts` first.

## Settings

There is no vendor setting and no protocol setting. A model is an address, a
key and two model names, and the student types all three: nothing is filled
in, and nothing points at anybody's service by default. How the endpoint
speaks is decided from the address by `protocolFor`: Anthropic's own host
gets its messages API, and everything else gets the OpenAI chat API, which is
what every hosted service, gateway and local server speaks. The window shows
what was decided beside the address and never asks.

`main/llm/service.ts` is the service layer. It owns what every protocol needs
alike: one queue, because some endpoints answer concurrency with a 429; a
backoff when an endpoint pushes back; and the schema check, since no protocol
enforces one. Under it a `Provider` speaks one protocol to one address and
nothing else, a file each for OpenAI chat completions and Anthropic messages,
both on the official SDKs. `providers.ts` is the only place a protocol name
meets a class, so a new protocol is a provider file and a line there. The model
list is read from the endpoint's own listing, and `isLocal` is what decides
whether to ask for a key. Each protocol shapes the address its own way,
OpenAI-style with `/v1` and Anthropic without, so the address is re-shaped on
every read.

Keys are sealed with Electron's `safeStorage`, which is the OS keychain. The
preferences window only ever receives whether a key is set and its last four
characters. Where there is no keychain the key is stored as written and the
window says so rather than pretending. A setting left blank falls through to
`.env`.

Preferences are a second window rather than part of the thread. The companion is
one conversation, and typing an API key into a conversation would be absurd. It
is a rail and a pane rather than a centred column, because a settings window
gets stretched: the form answers to the width it is given through a container
query, going to two columns once there is room. It has two tabs, because it
holds two unrelated things, and the tab is remembered in the window's own
storage.

What you are aiming at is typed, not picked. The eight tracks are what every
posting is tagged with, and evidence and gap statistics both filter on them, so
free text alone would match nothing. The phrase is searched against real job
titles and resolves to the track those titles carry, with "nothing like it"
said plainly when there is no such work. `swe` is a posting that named no
track, and a student who aims at it is aiming at every track.

## The look

Postings are primary sources, so the interface treats them that way. Two
surfaces, and the split carries the whole idea:

- **The app** is cool ink on a cool ground, in the system sans.
- **The working world** is warm paper in `ui-serif`, which is New York on macOS
  and Georgia elsewhere. Anything quoted from a posting arrives on it. It should look like it came from somewhere else.

The companion's own voice is neither: no bubble, no avatar, no name, flush left.
It is marginalia, the thing written in the margin of your notes. Everything
in the thread gets its own treatment rather than a variant of a chat bubble:
the companion's marginalia, the student's own words coming back quieter on the
right, and cited evidence cards from real postings.

No font files are bundled. `ui-serif` and `ui-monospace` reach the platform's
own optically sized faces. Swapping in a licensed face is two lines in
`styles.css`. The mark is drawn in code, in `bubble/logo.ts` for the orb and
`tray-mark.ts` for the menu bar, so there is no binary asset to keep in step.
The orb is a character, with a face laid out inside the mark's opening and a
mood for each thing the companion can be doing; [character.md](character.md)
has its geometry and manners.

## Two conventions

Relative imports carry explicit `.ts` extensions, and there are no TypeScript
parameter properties anywhere. Both exist so `node --test` can load any module
directly, with no build step and no test runner.

`electron-store` ships as ESM only and the main process is bundled as CommonJS,
so the import arrives as a module namespace. It is unwrapped in one place, in
`main/store.ts`.
