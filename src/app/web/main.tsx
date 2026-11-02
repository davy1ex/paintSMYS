import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import { webProjectAdapter } from './project-adapter'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App projectAdapter={webProjectAdapter} />
  </StrictMode>,
)
