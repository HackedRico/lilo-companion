import type { ChromeSetup, ChromeStatus } from './leetcode.ts'
import type { ConnectionResult, SettingsPatch, SettingsView } from './settings.ts'
import type { Aim, Card, CompanionState, Intent, Layout, Profile, Recap, ThreadItem } from './types.ts'
import type { Heard } from './voice.ts'

/** Main to renderer. */
export const OUT = {
  state: 'state:full',
  patch: 'state:patch',
  layout: 'layout',
  threadAdd: 'thread:add',
  threadToken: 'chat:token',
  threadEnd: 'thread:end',
  cardNew: 'card:new',
  profile: 'profile:data',
  recap: 'recap:data',
  focusComposer: 'ui:focus-composer'
} as const

/** Renderer to main. */
export const IN = {
  ready: 'ui:ready',
  lectureOpen: 'lecture:open',
  lectureDrop: 'lecture:drop',
  notes: 'input:notes',
  why: 'why:ask',
  chatSend: 'chat:send',
  sessionEnd: 'session:end',
  profileGet: 'profile:get',
  profileUpdate: 'profile:update',
  profileSignal: 'profile:signal',
  intent: 'ui:intent',
  toggle: 'ui:toggle',
  expand: 'ui:expand',
  dismissWhisper: 'ui:dismiss-whisper',
  dragStart: 'ui:drag-start',
  dragMove: 'ui:drag-move',
  dragEnd: 'ui:drag-end',
  resize: 'ui:resize',
  resizeEnd: 'ui:resize-end',
  clickThrough: 'ui:click-through',
  openLink: 'ui:open-link',
  typed: 'ui:typed',
  openPrefs: 'prefs:open',
  closePrefs: 'prefs:close',
  revealExtension: 'chrome:reveal',
  voice: 'ui:voice',
  practice: 'ui:practice'
} as const

export interface TokenPayload {
  id: string
  token: string
}

/** Request and reply, for the preferences window. */
export const ASK = {
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsTest: 'settings:test',
  settingsForget: 'settings:forget',
  profileRead: 'profile:read',
  profileWrite: 'profile:write',
  storagePath: 'settings:where',
  models: 'settings:models',
  resolveAims: 'profile:resolve-aims',
  connectChrome: 'chrome:connect',
  chromeStatus: 'chrome:status',
  transcribe: 'voice:transcribe'
} as const

/** What the preload hands the renderer. The renderer touches nothing else. */
export interface LiloApi {
  /** The renderer has no process of its own to ask. */
  readonly platform: NodeJS.Platform

  onState(cb: (state: CompanionState) => void): () => void
  onPatch(cb: (patch: Partial<CompanionState>) => void): () => void
  onLayout(cb: (layout: Layout) => void): () => void
  onThreadAdd(cb: (item: ThreadItem) => void): () => void
  onThreadToken(cb: (payload: TokenPayload) => void): () => void
  onThreadEnd(cb: (payload: { id: string } & Partial<ThreadItem>) => void): () => void
  onCard(cb: (card: Card) => void): () => void
  onProfile(cb: (profile: Profile) => void): () => void
  onRecap(cb: (recap: Recap) => void): () => void
  onFocusComposer(cb: () => void): () => void

  ready(): void
  /** Asks main for the file dialog, since the renderer has no way to open one. */
  openLecture(): void
  /**
   * A lecture dragged onto the companion. The renderer cannot see where a file
   * lives, so the preload reads its path and main opens it the same way the
   * picker does.
   */
  dropLecture(file: File): void
  sendNotes(text: string): void
  send(intent: Intent): void
  type(text: string): void
  updateProfile(patch: Partial<Profile>): void
  getProfile(): void

  toggle(): void
  expand(on: boolean): void
  dismissWhisper(): void

  dragStart(at: { x: number; y: number }): void
  dragMove(at: { x: number; y: number }): void
  dragEnd(): void
  /** Live, every frame of the corner drag. */
  resize(size: { width: number; height: number }): void
  /** Once, when the corner is let go, which is when it is worth writing down. */
  resizeEnd(): void
  setClickThrough(on: boolean): void
  openLink(url: string): void
  openPrefs(): void
  closePrefs(): void

  readSettings(): Promise<SettingsView>
  writeSettings(patch: SettingsPatch): Promise<SettingsView>
  testConnection(): Promise<ConnectionResult>
  forgetSettings(): Promise<SettingsView>
  readProfile(): Promise<Profile>
  writeProfile(patch: Partial<Profile>): Promise<Profile>
  storagePath(): Promise<string>
  listModels(query: string): Promise<{ models: string[]; detail: string }>
  resolveAims(said: string[]): Promise<Aim[]>
  /** Writes the native host manifest where Chrome looks for it. One time. */
  connectChrome(): Promise<ChromeSetup>
  chromeStatus(): Promise<ChromeStatus>
  revealExtension(): void
  /** Voice mode on or off. Main remembers it and says it back in the state. */
  setVoice(on: boolean): void
  /** Turns the LeetCode practice on and off. */
  setPractice(on: boolean): void
  /** One WAV from the microphone, and the words in it or the reason there are none. */
  transcribe(wav: ArrayBuffer): Promise<Heard>
}
