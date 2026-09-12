---
name: run-lilo
description: Launches and drives the Lilo desktop app to see a change working, with no microphone, no room and no lecture to attend. Use when asked to run, start, try or screenshot the app, or when a test cannot show the change. The same steps hold on macOS and Windows.
---

# Run Lilo

Lilo is an Electron app: an orb bottom right, a tray item beside the clock, no Dock or taskbar entry. Everything the app does, it can do from a saved transcript, so a change is checked without a microphone or a lecturer. `README.md` holds the install steps and stays the source of truth for them.

## Start it

```bash
npm run dev
```

If a fresh `npm install` left Electron's binary missing, run `node node_modules/electron/install.js` once. npm 11 blocks install scripts.

The window appears when the renderer is ready. Cmd/Ctrl+Shift+Y opens and closes the panel, Escape closes it. The tray menu is where the app quits from; from a shell, stop the dev process.

## Feed it a lecture

Nothing is bundled. Write a transcript in the scratchpad, one line per thing said, ten or more lines that teach something a student would look up. A line arrives every four seconds and the extract pass considers the last few minutes, so a three-line file never reaches a concept.

Point the app at it through `.env`, which both platforms read with no shell syntax:

```
REPLAY_FILE=<absolute path to lecture.txt, in the form this OS writes paths>
```

Or pick it at runtime from the tray under "Play a saved lecture". The main process also reads `--replay <file>` from argv, and electron-vite forwards what follows a second `--`: `npm run dev -- -- --replay <file>`.

A model has to be configured for anything past hearing: an address, a key and two model names, in `.env` or the preferences window. A local Ollama or LM Studio at its default address needs no key and nothing leaves the machine.

## Read what it is doing

Dev output is prefixed. `[lilo]` at start carries the posting count and the model, or "not configured". `[thread]` is every line the companion says. `[renderer]` and `[prefs]` are console output from the two windows. `LILO_DEBUG_LLM=1` prints every raw model reply and `LILO_OPEN_PREFS=1` opens the preferences window on launch; both are environment variables and both can sit in `.env`.

The tray's "Show saved data" opens the folder `electron-store` writes to. "End session and forget the transcript" resets the loop without quitting.

## Check it without launching

| | |
|---|---|
| `npm test` | every `*.test.ts` beside its module, through Node's own runner |
| `node --test main/watch.test.ts` | one file |
| `npm run typecheck` | the node, web and test projects |

The `MODULE_TYPELESS_PACKAGE_JSON` warning from the runner is noise. The main process bundles as CommonJS, so `package.json` cannot say `"type": "module"`.

## Where the platforms part

The commands are the same on both. What differs in the running app is in `docs/platforms.md`: on Windows the panel takes focus when clicked, stays on the desktop it opened on, and the tray mark is dark in a light halo rather than a template. Say which OS the run happened on when reporting. The `platform-parity` skill says what else that report carries.
