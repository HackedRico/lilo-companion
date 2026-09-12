import ElectronStore from 'electron-store'
import type { Point, Profile, Size } from '../shared/types.ts'
import { EMPTY_PROFILE } from './profile.ts'

/**
 * electron-store ships as ESM only, and the main process is bundled as
 * CommonJS, so the import arrives as a module namespace rather than the class.
 */
const Store = ((ElectronStore as unknown as { default?: typeof ElectronStore }).default ??
  ElectronStore) as typeof ElectronStore

/** What the preferences window has set. Anything absent falls through to .env. */
export interface SavedSettings {
  baseUrl?: string
  modelFast?: string
  modelStrong?: string
  /** Ciphertext when the platform has a keychain, otherwise the key itself. */
  apiKey?: string
  voiceUrl?: string
  voiceModel?: string
  /** Sealed the same way as apiKey. */
  voiceKey?: string
}

interface Saved {
  orb: Point | null
  /** What the panel was dragged to, before any display had a say in it. */
  panel: Size | null
  profile: Profile
  settings: SavedSettings
  /** Voice mode. Off, nothing in the app may open the microphone. */
  voice: boolean
}

/**
 * Local only, and deliberately small. The transcript is dropped when the
 * session ends, so this holds the profile, the settings, and where the student
 * left the orb.
 */
export class Prefs {
  private readonly store = new Store<Saved>({
    name: 'lilo',
    defaults: { orb: null, panel: null, profile: EMPTY_PROFILE, settings: {}, voice: false }
  })

  get orb(): Point | null {
    return this.store.get('orb')
  }

  set orb(value: Point | null) {
    this.store.set('orb', value)
  }

  get panel(): Size | null {
    return this.store.get('panel')
  }

  set panel(value: Size | null) {
    this.store.set('panel', value)
  }

  get profile(): Profile {
    return { ...EMPTY_PROFILE, ...this.store.get('profile') }
  }

  set profile(value: Profile) {
    this.store.set('profile', value)
  }

  get settings(): SavedSettings {
    return this.store.get('settings') ?? {}
  }

  set settings(value: SavedSettings) {
    this.store.set('settings', value)
  }

  get voice(): boolean {
    return this.store.get('voice') === true
  }

  set voice(value: boolean) {
    this.store.set('voice', value)
  }

  /** Everything the student ever told us, gone. */
  forgetEverything(): void {
    this.store.clear()
  }

  get path(): string {
    return this.store.path
  }
}
