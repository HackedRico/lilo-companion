import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { ASK, IN, OUT, type LiloApi, type TokenPayload } from '../shared/api.ts'
import type { SettingsPatch } from '../shared/settings.ts'
import type {
  Card,
  CompanionState,
  Intent,
  Layout,
  Profile,
  Recap,
  ThreadItem
} from '../shared/types.ts'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: LiloApi = {
  platform: process.platform,

  onState: (cb) => on<CompanionState>(OUT.state, cb),
  onPatch: (cb) => on<Partial<CompanionState>>(OUT.patch, cb),
  onLayout: (cb) => on<Layout>(OUT.layout, cb),
  onThreadAdd: (cb) => on<ThreadItem>(OUT.threadAdd, cb),
  onThreadToken: (cb) => on<TokenPayload>(OUT.threadToken, cb),
  onThreadEnd: (cb) => on<{ id: string } & Partial<ThreadItem>>(OUT.threadEnd, cb),
  onCard: (cb) => on<Card>(OUT.cardNew, cb),
  onProfile: (cb) => on<Profile>(OUT.profile, cb),
  onRecap: (cb) => on<Recap>(OUT.recap, cb),
  onFocusComposer: (cb) => on<void>(OUT.focusComposer, cb),

  ready: () => ipcRenderer.send(IN.ready),
  openLecture: () => ipcRenderer.send(IN.lectureOpen),
  sendNotes: (text: string) => ipcRenderer.send(IN.notes, text),
  send: (intent: Intent) => ipcRenderer.send(IN.intent, intent),
  type: (text: string) => ipcRenderer.send(IN.typed, text),
  updateProfile: (patch: Partial<Profile>) => ipcRenderer.send(IN.profileUpdate, patch),
  getProfile: () => ipcRenderer.send(IN.profileGet),

  toggle: () => ipcRenderer.send(IN.toggle),
  expand: (value: boolean) => ipcRenderer.send(IN.expand, value),
  dismissWhisper: () => ipcRenderer.send(IN.dismissWhisper),

  dragStart: (at) => ipcRenderer.send(IN.dragStart, at),
  dragMove: (at) => ipcRenderer.send(IN.dragMove, at),
  dragEnd: () => ipcRenderer.send(IN.dragEnd),
  resize: (size) => ipcRenderer.send(IN.resize, size),
  resizeEnd: () => ipcRenderer.send(IN.resizeEnd),
  setClickThrough: (value: boolean) => ipcRenderer.send(IN.clickThrough, value),
  openLink: (url: string) => ipcRenderer.send(IN.openLink, url),
  openPrefs: () => ipcRenderer.send(IN.openPrefs),
  closePrefs: () => ipcRenderer.send(IN.closePrefs),

  readSettings: () => ipcRenderer.invoke(ASK.settingsGet),
  writeSettings: (patch: SettingsPatch) => ipcRenderer.invoke(ASK.settingsSet, patch),
  testConnection: () => ipcRenderer.invoke(ASK.settingsTest),
  forgetSettings: () => ipcRenderer.invoke(ASK.settingsForget),
  readProfile: () => ipcRenderer.invoke(ASK.profileRead),
  writeProfile: (patch: Partial<Profile>) => ipcRenderer.invoke(ASK.profileWrite, patch),
  storagePath: () => ipcRenderer.invoke(ASK.storagePath),
  listModels: (query: string) => ipcRenderer.invoke(ASK.models, query),
  resolveAims: (said: string[]) => ipcRenderer.invoke(ASK.resolveAims, said)
}

contextBridge.exposeInMainWorld('lilo', api)
