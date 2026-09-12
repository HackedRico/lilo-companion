import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { api } from './api.ts'
import { Mic } from './audio/mic.ts'
import { useApp } from './store.ts'
import './styles.css'

const store = useApp.getState()

api.onState((state) => store.setCompanion(state))
api.onPatch((patch) => store.patch(patch))
api.onLayout((layout) => store.setLayout(layout))
api.onThreadAdd((item) => store.addItem(item))
api.onThreadToken(({ id, token }) => store.appendToken(id, token))
api.onThreadEnd(({ id, ...patch }) => store.endItem(id, patch))
api.onProfile((profile) => store.setProfile(profile))
api.onRecap((recap) => store.setRecap(recap))

// The microphone is held here; the chunks go straight back out to main.
const mic = new Mic((chunk) => api.sendAudio(chunk))
api.onCapture((on) => {
  if (!on) {
    mic.stop()
    return
  }
  mic.start().catch((error: unknown) => {
    api.audioFailed(error instanceof Error ? error.message : String(error))
  })
})

api.ready()

const host = document.getElementById('root')
if (host) createRoot(host).render(<App />)
