import { useEffect, useState } from 'react'
import { openProjectSession, createUntitledProjectSession, type ProjectSession } from '../application/project-session'
import type { ProjectOpenPort } from '../application/project-open-port'
import EditorWorkspace from '../editor/workspace/EditorWorkspace'
import NewProjectScreen from './screens/NewProjectScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import './app.css'

type AppProps = {
  projectAdapter: ProjectOpenPort
}

function App({ projectAdapter }: AppProps) {
  const [screen, setScreen] = useState<'welcome' | 'new-project'>('welcome')
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.title = session ? `${session.projectName} — paintSMYS` : 'paintSMYS'
  }, [session])

  async function openProject() {
    setBusy(true)
    setError(null)
    try {
      const selection = await projectAdapter.openProject()
      if (selection.status === 'cancelled') return
      if (selection.status === 'error') {
        setError(selection.message)
        return
      }

      // Build and validate the complete next session before replacing the active one.
      const nextSession = openProjectSession(selection.manifestText, selection.projectRoot)
      setSession(nextSession)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'The project could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  function createProject(width: number, height: number) {
    setError(null)
    setSession(createUntitledProjectSession(width, height))
  }

  if (session) return <EditorWorkspace session={session} />

  if (screen === 'new-project') {
    return <NewProjectScreen error={error} onBack={() => { setScreen('welcome'); setError(null) }} onCreate={createProject} />
  }

  return (
    <WelcomeScreen
      busy={busy}
      error={error}
      onNewProject={() => { setScreen('new-project'); setError(null) }}
      onOpenProject={() => void openProject()}
    />
  )
}

export default App
