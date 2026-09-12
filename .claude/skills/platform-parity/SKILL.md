---
name: platform-parity
description: Keeps a change to Lilo working on both macOS and Windows, and says what was checked where. Use when editing the window, tray, shortcuts, keychain, file paths or packaging, any code that branches on process.platform, CSS that names a font or a platform, or when a change has only been tried on one OS.
---

# Platform parity

Lilo ships on macOS and Windows from one codebase, and a Mac is where most of it gets written. Parity is a property of every change, not a pass at the end: the Windows branch is written beside the macOS branch, in the same commit, or the change is not done.

`docs/platforms.md` is the reference for what differs and why. This skill is the process for changing code that lands on that reference.

## Process

1. **Name the surface.** Match every file in the diff against the table below. A diff that touches none of them is platform-neutral, and the rest of this skill does not apply.
2. **Read the branch you are not on.** For each surface, read its section of `docs/platforms.md` and the code path the other OS takes before writing anything.
3. **Write both branches together.** Where an Electron call exists on one OS only, guard it on `process.platform` and leave a comment saying what the other OS does instead. `type: 'panel'` in `main/panel.ts` is the model. An unguarded macOS-only call is a crash on Windows, and a guard with no comment is a question for the next reader.
4. **Verify what can be verified here.** `npm test` and `npm run typecheck` run everywhere. A dev run on the machine in front of you checks that OS only.
5. **Say what was not verified.** CI packages on both OSes and proves the build, not the behaviour. The commit or PR body names each surface touched and the OS it was tried on. Behaviour on the other OS is written down as untried, never assumed.

Done when every surface in the diff has both branches accounted for and the commit body says what was tried on which OS.

## Surfaces

| Surface | Files | The trap | Section of `docs/platforms.md` |
|---|---|---|---|
| Window, focus, on top | `main/panel.ts`, `main/prefs-window.ts`, `main/index.ts` | `type: 'panel'`, `app.dock` and `titleBarStyle: 'hiddenInset'` are macOS. `setVisibleOnAllWorkspaces` is a no-op on Windows. | Typing into the panel; Always on top, and where it stops |
| Click-through | `main/panel.ts`, `renderer/App.tsx` | `setIgnoreMouseEvents` needs `{ forward: true }` for Windows, and fails by going quiet. | Transparency and the pass-through |
| Tray | `main/tray.ts`, `main/tray-icon.ts`, `main/tray-mark.ts` | A template image is macOS only. Windows wants the halo and 18 physical pixels at 100%. | What is the same: the tray mark |
| Shortcuts | `main/index.ts`, `main/tray.ts`, `renderer/App.tsx` | `CommandOrControl` in accelerators. `input.meta` on macOS, `input.control` elsewhere. The renderer checks `metaKey` and `ctrlKey` both. | What is the same: shortcuts |
| Keys | `main/settings.ts`, `main/store.ts` | `safeStorage` may be unavailable. The `encrypted` flag tells the preferences window. | What is the same: keys |
| Files and paths | anything importing `node:path` or `node:fs` | `join` from `node:path`, never a `/` in a string. `process.resourcesPath` when packaged, `app.getAppPath()` in dev. A file written on Windows carries `\r\n`, so lines are trimmed. | none; the rule lives here |
| Type and CSS | `renderer/styles.css` | No font files. `ui-serif` and `Segoe UI Variable Text` resolve per platform. Platform-only CSS hangs off `:root[data-platform]`. | What is the same: type |
| Chrome host | `main/leetcode/connect.ts`, `main/leetcode/bridge.ts`, `main/host.ts` | The manifest is a file on macOS and a registry key on Windows. The launcher is a shell script or a batch file. The socket is a file or a named pipe. Build the other platform's path with its own `posix` or `win32`. | Chrome and the native host |
| Packaging | `electron-builder.yml`, `.github/workflows/build.yml` | Unsigned on both. `package:mac` and `package:win` each run on their own OS; CI is the Windows build. | Shipping |

## Checking Windows from a Mac

- `npm test` covers what is pure: the tray pixels, the layout maths, the guards, the loop against a scripted model. Put platform logic in a pure module beside its Electron caller, the way `tray-mark.ts` sits beside `tray-icon.ts`, so a test can reach it on any OS.
- A push to `main` or a pull request runs the `package` job on `windows-latest`. Green means it built and packaged. It says nothing about focus, transparency or the tray.
- What only a Windows desktop can show, focus on click, the panel over a fullscreen app, transparency over Remote Desktop, goes in the commit body as untried. Guessing that it works is the failure this skill exists to stop.
