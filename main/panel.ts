import { BrowserWindow, screen, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import {
  FIRST_INSET,
  ORB,
  PANEL,
  choosePlacement,
  clampToWork,
  collapsedLayout,
  expandedLayout,
  fitPanel,
  whisperLayout
} from '../shared/layout.ts'
import { OUT } from '../shared/api.ts'
import type { Layout, Placement, Point, Rect, Size } from '../shared/types.ts'

/**
 * How often the pointer is asked for. Fast enough that a file carried over the
 * companion is taken, slow enough to be nothing: one call into the window
 * server, eight times a second.
 */
const CURSOR_EVERY = 120

/**
 * The one window. It floats above whatever the student is working in and never
 * takes that app out of front. The orb is the fixed point: opening and closing
 * the panel move the window's edges, never the orb's place on screen.
 */
export class Panel {
  readonly win: BrowserWindow
  private expanded = false
  private whispering = false
  private placement: Placement = { side: 'left', edge: 'up' }
  private orb: Point
  /** What the student asked for. What they get is this, fitted to the display. */
  private wanted: Size
  private dragOffset: Point | null = null
  private passthrough = true
  /** What was last asked of the window, so the watch does not ask again every tick. */
  private ignoring = false
  private watch: ReturnType<typeof setInterval> | null = null

  onExpandedChange: ((expanded: boolean) => void) | null = null

  constructor(startAt: Point | null, size: Size | null) {
    this.orb = startAt ?? firstRunOrb()
    this.wanted = size ?? PANEL
    this.win = new BrowserWindow(this.options())
    this.harden()
    this.apply()
    void this.load()
    this.watchCursor()
    this.win.on('closed', () => this.close())
    screen.on('display-metrics-changed', () => this.apply())
  }

  private options(): BrowserWindowConstructorOptions {
    const layout = collapsedLayout()
    const opts: BrowserWindowConstructorOptions = {
      ...this.originFor(layout),
      ...layout.window,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      // A transparent window's native shadow is recomputed from the alpha mask
      // every frame. The panel draws its own instead.
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    }
    if (process.platform === 'darwin') {
      // NSWindowStyleMaskNonactivatingPanel: typing into the panel leaves the
      // lecture, the browser or the editor underneath still in front.
      opts.type = 'panel'
    }
    return opts
  }

  private harden(): void {
    this.win.setAlwaysOnTop(true, 'floating')
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    this.win.once('ready-to-show', () => this.win.showInactive())
  }

  private async load(): Promise<void> {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) await this.win.loadURL(devUrl)
    else await this.win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Geometry -------------------------------------------------------------

  private layout(): Layout {
    if (this.expanded) return expandedLayout(fitPanel(this.work(), this.wanted), this.placement)
    if (this.whispering) return whisperLayout(this.placement)
    return collapsedLayout()
  }

  /** A whisper grows the window just enough to hold one line beside the orb. */
  setWhisper(on: boolean): void {
    if (on === this.whispering) return
    if (on && !this.expanded) this.placement = choosePlacement(this.orb, this.work())
    this.whispering = on
    if (!this.expanded) this.apply()
  }

  private originFor(layout: Layout): Point {
    if (!layout.orb) return { x: 0, y: 0 }
    return { x: Math.round(this.orb.x - layout.orb.x), y: Math.round(this.orb.y - layout.orb.y) }
  }

  private work(): Rect {
    return screen.getDisplayNearestPoint({
      x: Math.round(this.orb.x + ORB / 2),
      y: Math.round(this.orb.y + ORB / 2)
    }).workArea
  }

  private apply(): void {
    const layout = this.layout()
    const bounds = clampToWork({ ...this.originFor(layout), ...layout.window }, this.work())
    // Clamping can shift the window, and with it the orb. Keep the record
    // honest so closing puts the orb back where it now sits.
    if (layout.orb) this.orb = { x: bounds.x + layout.orb.x, y: bounds.y + layout.orb.y }
    this.win.setBounds(bounds, false)
    this.send(OUT.layout, layout)
  }

  private send(channel: string, payload: unknown): void {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload)
  }

  emit(channel: string, payload: unknown): void {
    this.send(channel, payload)
  }

  pushLayout(): void {
    this.send(OUT.layout, this.layout())
  }

  get position(): Point {
    return this.orb
  }

  // Opening and closing --------------------------------------------------

  setExpanded(on: boolean): void {
    if (on === this.expanded) return
    // The side is decided at the moment it opens, and held until it closes.
    if (on) this.placement = choosePlacement(this.orb, this.work())
    this.expanded = on
    this.apply()
    if (on) this.send(OUT.focusComposer, undefined)
    this.onExpandedChange?.(on)
  }

  toggle(): void {
    this.setExpanded(!this.expanded)
  }

  /**
   * The panel grows away from the orb, which never moves, so the corner being
   * dragged is the only edge that travels. The display still has the last word
   * on what actually fits.
   */
  resize(wanted: Size): Size {
    this.wanted = wanted
    if (this.expanded) this.apply()
    return this.size
  }

  /** What the panel is at right now, which is what is worth remembering. */
  get size(): Size {
    return fitPanel(this.work(), this.wanted)
  }

  get isExpanded(): boolean {
    return this.expanded
  }

  /** Escape closes the panel, then hands focus back to the app beneath. */
  stepDown(): void {
    this.setExpanded(false)
    // On Windows blur hands focus to the next topmost window, not to the app
    // beneath, so only macOS gets the step down.
    if (process.platform === 'darwin') this.win.blur()
  }

  setVisible(on: boolean): void {
    if (on) this.win.showInactive()
    else this.win.hide()
  }

  // Dragging -------------------------------------------------------------

  dragStart(at: Point): void {
    const bounds = this.win.getBounds()
    const offset = { x: at.x - bounds.x, y: at.y - bounds.y }
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.y)) return
    this.dragOffset = offset
  }

  dragMove(at: Point): void {
    if (!this.dragOffset) return
    const x = Math.round(at.x - this.dragOffset.x) | 0
    const y = Math.round(at.y - this.dragOffset.y) | 0
    // Electron throws on a coordinate it cannot convert rather than ignoring it.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    try {
      this.win.setPosition(x, y)
    } catch {
      // Ignore transient conversion issues during rapid drag
    }
  }

  dragEnd(): Point {
    this.dragOffset = null
    const layout = this.layout()
    const bounds = this.win.getBounds()
    if (layout.orb) this.orb = { x: bounds.x + layout.orb.x, y: bounds.y + layout.orb.y }
    // After a drag the window is pulled back on screen.
    this.apply()
    return this.orb
  }

  // Click-through --------------------------------------------------------

  /**
   * The window is bigger than what it draws. Everything the companion is not
   * standing on lets the click reach the app underneath.
   */
  setClickThrough(on: boolean): void {
    if (this.dragOffset || !this.passthrough) return
    this.ignoring = on
    this.win.setIgnoreMouseEvents(on, { forward: true })
  }

  /**
   * Where the pointer is, asked rather than waited for.
   *
   * The renderer decides what is solid from mouse moves, and a file dragged in
   * from Finder produces none: the system is carrying a file, not moving a
   * cursor. A window that is ignoring mouse input does not accept a drop
   * either, so a lecture dragged onto the companion went to whatever was
   * behind it. This only ever makes the window solid, never the other way, so
   * it can rescue that case without overruling anything the renderer knows
   * about elements this does not.
   */
  private watchCursor(): void {
    this.watch = setInterval(() => {
      if (!this.ignoring || this.dragOffset || this.win.isDestroyed()) return
      if (this.covers(screen.getCursorScreenPoint())) this.setClickThrough(false)
    }, CURSOR_EVERY)
  }

  /** Whether a point on screen is over what the companion is drawing. */
  private covers(point: Point): boolean {
    const bounds = this.win.getBounds()
    const layout = this.layout()
    return [layout.orb, layout.panel].some((rect) => {
      if (!rect) return false
      const x = bounds.x + rect.x
      const y = bounds.y + rect.y
      return point.x >= x && point.x < x + rect.width && point.y >= y && point.y < y + rect.height
    })
  }

  /** Stops the cursor watch. Called when the window goes. */
  close(): void {
    if (this.watch) clearInterval(this.watch)
    this.watch = null
  }

  /** The way out if forwarded mouse moves ever stop arriving. */
  setPassthrough(on: boolean): void {
    this.passthrough = on
    if (!on) {
      this.ignoring = false
      this.win.setIgnoreMouseEvents(false)
    }
  }

  get isPassthrough(): boolean {
    return this.passthrough
  }
}

function firstRunOrb(): Point {
  const work = screen.getPrimaryDisplay().workArea
  return {
    x: work.x + work.width - FIRST_INSET - ORB,
    y: work.y + work.height - FIRST_INSET - ORB
  }
}
