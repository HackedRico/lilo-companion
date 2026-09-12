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

## Audio

The microphone path is the same code on both. `getUserMedia`, `MediaRecorder`
and webm/opus behave the same, so `audio/mic.ts` needs nothing per platform.

**A signed macOS build hears nothing without the entitlement.** The hardened
runtime is on for signed builds, and `build/entitlements.mac.plist` grants
`com.apple.security.device.audio-input`; leave that pair together.

**A refusal reads differently.** macOS shows a prompt, and
`NSMicrophoneUsageDescription` in `electron-builder.yml` explains it. Windows
has a privacy setting and no prompt to trigger, so `getUserMedia` simply rejects
and the app has to say why in its own words.

**System audio would be two implementations, not a flag.** Windows does loopback
through `setDisplayMediaRequestHandler` with a loopback audio source. macOS needs
ScreenCaptureKit, which depends on the Electron version, or a virtual device the
student installs. Hearing a lecture playing on the machine itself is where that
gets expensive.

## Shipping

Installers are unsigned, because nothing configures signing. On Windows that
means SmartScreen warns on every download until a certificate earns reputation;
an EV certificate skips the wait. Signing is a certificate and password in the
`win` block of `electron-builder.yml`. The nsis target defaults to a per-user
install, which needs no admin rights.
