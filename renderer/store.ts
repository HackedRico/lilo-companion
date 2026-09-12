import { create } from 'zustand'
import { collapsedLayout } from '../shared/layout.ts'
import type { CompanionState, Layout, Profile, Recap, ThreadItem } from '../shared/types.ts'

const EMPTY_COMPANION: CompanionState = {
  orb: 'idle',
  expanded: false,
  thread: [],
  suggestions: [],
  whisper: null,
  composing: false,
  watching: [],
  activeScenarioId: null,
  composer: { mode: 'chat', hint: 'Ask me anything', who: null, scenarioId: null },
  onboarded: true
}

const EMPTY_PROFILE: Profile = {
  major: '',
  year: '',
  courses: [],
  aims: [],
  targetRoles: [],
  interests: [],
  roleAffinity: {},
  heardTerms: []
}

interface AppStore {
  companion: CompanionState
  layout: Layout
  profile: Profile
  recap: Recap | null
  setCompanion(state: CompanionState): void
  patch(patch: Partial<CompanionState>): void
  setLayout(layout: Layout): void
  addItem(item: ThreadItem): void
  appendToken(id: string, token: string): void
  endItem(id: string, patch?: Partial<ThreadItem>): void
  setProfile(profile: Profile): void
  setRecap(recap: Recap): void
}

export const useApp = create<AppStore>((set) => ({
  companion: EMPTY_COMPANION,
  layout: collapsedLayout(),
  profile: EMPTY_PROFILE,
  recap: null,

  setCompanion: (companion) => set({ companion }),
  patch: (patch) => set((state) => ({ companion: { ...state.companion, ...patch } })),
  setLayout: (layout) => set({ layout }),

  addItem: (item) =>
    set((state) => ({ companion: { ...state.companion, thread: [...state.companion.thread, item] } })),

  // Tokens land one at a time, so the line grows the way it was spoken.
  appendToken: (id, token) =>
    set((state) => ({
      companion: {
        ...state.companion,
        thread: state.companion.thread.map((item) =>
          item.id === id ? { ...item, text: item.text + token } : item
        )
      }
    })),

  endItem: (id, patch) =>
    set((state) => ({
      companion: {
        ...state.companion,
        thread: state.companion.thread.map((item) =>
          item.id === id ? { ...item, ...patch, streaming: false } : item
        )
      }
    })),

  setProfile: (profile) => set({ profile }),
  setRecap: (recap) => set({ recap })
}))
