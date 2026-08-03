import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

export function App() {
  return (
    <main>
      <p className="eyebrow">WAYPOINT · PHASE 0</p>
      <h1>Your thinking,<br />within reach.</h1>
      <p className="summary">
        This shell validates the secure Electron and React delivery path. Product
        workflows begin only after the Phase 0 architecture gate passes.
      </p>
      <section aria-label="Prototype status">
        <span>Local-first</span><span>Inspectable AI</span><span>Owned sync</span>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
