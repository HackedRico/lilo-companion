---
name: panel-ui
description: Adds or changes something the student sees or touches in Lilo, the orb, the whisper, the thread panel or the preferences window, and the channel that carries it from main. Use when editing renderer/ or preload/, adding an IPC channel, or when a click falls through the panel to the app underneath.
---

# Panel UI

The renderer draws into a transparent, always-on-top window that is bigger than what it shows. The main process owns geometry and sends it down as a `Layout`; the renderer decides only what is solid under the pointer. `docs/architecture.md` under "The window" and "The look" carries the reasoning, and the global `frontend-design` skill carries the craft. This skill is what a change here has to get right to work at all.

## Solid or not

`useClickThrough` in `renderer/App.tsx` hit-tests every mouse move and lets clicks through wherever the element under the pointer has no `[data-solid]` ancestor. Any new thing the student can click or type into carries `data-solid=""` on its outermost element, or it is dead on arrival: the click lands in the lecture behind it. The orb, the whisper and the panel root already carry it. A popover or a menu rendered outside them needs its own.

Done when a click on the new element does something and a click beside it reaches the app underneath, on both OSes.

## A new channel between main and renderer

The preload is the only door. Nothing in the renderer touches Electron, and `renderer/api.ts` throws if the bridge is missing.

1. Name the channel in `shared/api.ts`: `OUT` for main to renderer, `IN` for renderer to main, `ASK` for request and reply.
2. Add the method to `LiloApi` there and its implementation in `preload/index.ts`.
3. Handle it in `main/index.ts`. Anything from a renderer that reaches a window or the file system passes through `main/guards.ts` first, `asPoint`, `asSize` or `asText`: Electron throws on a coordinate it cannot convert, and a renderer must never be able to take main down.
4. `npm run typecheck` covers all three projects. The shared types are what keep the two sides honest.

## Two surfaces, four speakers

The app is cool ink on a cool ground in `--sans`. Anything from the working world, a quoted posting or a coworker's message, sits on `--paper` in `--serif` and should look like it came from somewhere else. The companion speaks unboxed and flush left. Four speakers in the thread and each has its own treatment in `Line.tsx`; a fifth gets a fifth, never a variant of a bubble.

Every colour is a token in `renderer/styles.css` with a dark value under `prefers-color-scheme`. No font files are bundled: `ui-serif` and `ui-monospace` reach the platform's own faces, and `:root[data-platform='darwin']` is the hook for what only one platform draws, such as the inset lights on the settings rail.

## What the built page allows

The CSP in `index.html` and `settings.html` permits no inline script in the built page; `%CSP_DEV%` opens it for the Vite client in dev only. Inline styles are allowed. Images are `self` or `data:`, so a mark is drawn in code, in `renderer/bubble/` for the orb and `main/tray-mark.ts` for the tray, rather than shipped as a file. Postings open in the student's browser through `openLink`, never inside the panel.
