# Platforms

What differs between macOS and Windows, and where the difference is visible to
a student rather than only to the code.

## What is the same

**No taskbar or Dock entry.** `skipTaskbar: true` in `panel.ts` is what
`app.dock.hide()` and `LSUIElement` do on macOS. The tray item exists on both,
so the companion stays a thing in the corner rather than a window in the
switcher.

**The tray mark.** `tray-icon.ts` draws a template image for macOS, which the
menu bar inverts for itself. Everywhere else the mark is dark inside a light
halo, because a Windows taskbar can be light, dark or an accent colour and
nothing reports which: the app theme bit is `AppsUseLightTheme` and the taskbar
follows `SystemUsesLightTheme`, which Windows 11 lets differ. The pixels are in
`tray-mark.ts` with no Electron in them, so `tray-mark.test.ts` checks the halo
rather than a person squinting at a bar. Every scale is carried as its own
representation, because the notification area asks for 18 physical pixels at
100% and downscaling the Retina square to get there loses the stem.

**Keys.** `safeStorage` is Keychain on macOS and DPAPI on Windows. The
`encrypted` flag tells the preferences window when there is neither.

**Type.** No font files are bundled. `--sans` names Segoe UI Variable Text ahead
of `system-ui`, and `ui-serif` resolves to New York on macOS and Georgia
elsewhere, which is the face the paper surface was designed against.

**Shortcuts.** `index.ts` reads `input.control` off macOS for the editing
bridge. The panel toggle is `CommandOrControl+Shift+Y`.

**The title bar.** `prefs-window.ts` falls back to `default` off macOS, so the
preferences window keeps its own controls.

## Typing into the panel

This is the one real difference. On macOS `type: 'panel'` lets the composer be
typed into while the lecture behind it stays the active app.

Windows has no equivalent. The Win32 flag is `WS_EX_NOACTIVATE` and Electron
does not expose it, and both ways around it are worse than they look:

- `focusable: false` is all or nothing. The window never takes focus, so the
  composer can never be typed into, which removes the app.
- `WS_EX_NOACTIVATE` through a native addon on `getNativeWindowHandle()` stops
  the click from activating the window, and stops the keystrokes arriving with
  it. Windows does not separate the key window from the active app, and that
  separation is the whole of what `NSPanel` is selling.

So on Windows the panel takes focus when clicked. A browser playing a lecture
keeps playing when it loses focus; what changes is the title bar dimming and
keyboard shortcuts going to the panel instead of the page.

## Always on top, and where it stops

`setVisibleOnAllWorkspaces` is a no-op outside macOS and Linux, so on Windows
the panel lives on the desktop it was opened on. The `'floating'` level
collapses into plain topmost, and every level above normal is the same level, so
there is nothing to raise the panel above another topmost window.

An exclusive fullscreen app covers the panel and no flag prevents it. Presenter
view and most games take the screen that way. A browser at F11 does not, so a
lecture playing in a browser is fine.

## Transparency and the pass-through

The transparent frameless window works on both, with two failure modes worth
knowing:

**Transparency needs the compositor.** With hardware acceleration off, or over
Remote Desktop, the window can come back black instead of clear.

**The hit test.** `panel.ts` passes `{ forward: true }` to
`setIgnoreMouseEvents`, which is the flag that exists for Windows: hover keeps
reaching the renderer while clicks pass through to the app underneath. When it
fails it fails quietly, by the orb going dead rather than by throwing.

## The microphone

Voice mode asks for the microphone from the renderer, through `getUserMedia`,
and `index.ts` grants exactly that: audio, for the panel's own page, and no
other permission for any page. The prompt the student sees is the OS's own.

On macOS the prompt comes from TCC the first time, and only if the bundle
carries `NSMicrophoneUsageDescription`, which `electron-builder.yml` puts in
the Info.plist; a signed build also needs `com.apple.security.device.audio-input`
in the entitlements, which is there too. In dev the prompt names Electron,
because it is Electron's own plist. A refusal is remembered under System
Settings, Privacy & Security, Microphone, and the composer says so.

On Windows there is no plist and no per-app prompt. Settings, Privacy &
security, Microphone has one switch for desktop apps, and with it off
`getUserMedia` fails with `NotAllowedError`, which the composer says the same
way with the Windows path. Untried on Windows: the switch, and recording
through a laptop's own microphone array.

## Chrome and the native host

Chrome launches a native messaging host by the path in a manifest, and the
manifest lives somewhere different per platform. On macOS it is a file under
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`. On
Windows it can live anywhere, and a key under
`HKCU\Software\Google\Chrome\NativeMessagingHosts` names the file, written
with `reg add`. On Linux it is `~/.config/google-chrome/NativeMessagingHosts/`.
`manifestPlace` in `main/leetcode/connect.ts` holds all three and builds each
path with that platform's own `node:path`, so the Windows half is tested from
a Mac.

The host has to be an executable, so the launcher is a shell script on macOS
and Linux and a batch file on Windows, each running the app's own binary with
`ELECTRON_RUN_AS_NODE=1` on `host.js` and the socket path. A shell script
Chrome cannot execute fails silently, which is why the installer sets the mode
bit. The socket is a named pipe on Windows and a file in the temp directory
elsewhere: a Unix socket path is capped near a hundred characters, and a user
data directory can be longer than that on its own.

Untried on Windows: the registry write, the batch launcher under Chrome, and
the named pipe. Each is guarded on `process.platform` and written beside its
macOS branch.

## Shipping

Installers are unsigned, because nothing configures signing. On Windows that
means SmartScreen warns on every download until a certificate earns reputation;
an EV certificate skips the wait. Signing is a certificate and password in the
`win` block of `electron-builder.yml`. The nsis target defaults to a per-user
install, which needs no admin rights.
