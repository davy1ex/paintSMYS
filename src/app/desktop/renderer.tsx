import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import DesktopWindowFrame from './window/DesktopWindowFrame'
import { desktopProjectAdapter } from './project-adapter'
import { createDesktopPluginRuntime } from './plugins/create-desktop-plugin-runtime'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element was not found')
}

const app = window.paintSMYS?.platform === 'linux'
  ? <DesktopWindowFrame><App projectAdapter={desktopProjectAdapter} pluginRuntimeFactory={createDesktopPluginRuntime} /></DesktopWindowFrame>
  : <App projectAdapter={desktopProjectAdapter} pluginRuntimeFactory={createDesktopPluginRuntime} />

createRoot(rootElement).render(
  <StrictMode>{app}</StrictMode>,
)
