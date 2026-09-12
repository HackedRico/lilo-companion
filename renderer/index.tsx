import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { api } from './api.ts'
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

api.ready()

const host = document.getElementById('root')
if (host) createRoot(host).render(<App />)
