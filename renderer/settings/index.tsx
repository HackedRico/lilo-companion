import { createRoot } from 'react-dom/client'
import { Prefs } from './Prefs.tsx'
import '../styles.css'

const host = document.getElementById('root')
if (host) createRoot(host).render(<Prefs />)
