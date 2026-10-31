import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import DesktopWindowFrame from './window/DesktopWindowFrame'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element was not found')
}

const app = window.paintSMYS?.platform === 'linux'
  ? <DesktopWindowFrame><App /></DesktopWindowFrame>
  : <App />

createRoot(rootElement).render(
  <StrictMode>{app}</StrictMode>,
)
