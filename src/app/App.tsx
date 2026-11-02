import { useEffect, useRef, useState } from 'react'
import { openProjectSession, createUntitledProjectSession, type ProjectSession } from '../application/project-session'
import type { ProjectOpenPort } from '../application/project-open-port'
import type { ProjectSaveMode, ProjectSavePort } from '../application/project-save-port'
import { mergeSavedProjectSession, saveProjectSession } from '../application/save-project-session'
import EditorWorkspace from '../editor/workspace/EditorWorkspace'
import NewProjectScreen from './screens/NewProjectScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import './app.css'

type AppProps = {
  projectAdapter: ProjectOpenPort & Partial<ProjectSavePort>
}

function App({ projectAdapter }: AppProps) {
  const [screen, setScreen] = useState<'welcome' | 'new-project'>('welcome')
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const sessionRef = useRef<ProjectSession | null>(null)
  const savingRef = useRef(false)

  function setActiveSession(nextSession: ProjectSession) {
    sessionRef.current = nextSession
    setSession(nextSession)
  }

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
      setActiveSession(nextSession)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'The project could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  function createProject(width: number, height: number) {
    setError(null)
    setStatusMessage('')
    setActiveSession(createUntitledProjectSession(width, height))
  }

  async function save(mode: ProjectSaveMode = 'save') {
    if (!projectAdapter.saveProject || savingRef.current) return
    const snapshot = sessionRef.current
    if (!snapshot) return

    savingRef.current = true
    setSaving(true)
    setError(null)
    setStatusMessage('Saving…')
    try {
      const result = await saveProjectSession(snapshot, projectAdapter as ProjectOpenPort & ProjectSavePort, mode)
      if (result.status === 'cancelled') {
        setStatusMessage('Save cancelled.')
        return
      }
      if (result.status === 'error') {
        setError(result.message)
        setStatusMessage('Save failed.')
        return
      }

      const current = sessionRef.current
      const updatedSession = mergeSavedProjectSession(snapshot, current, result.session)
      if (!updatedSession) return
      setActiveSession(updatedSession)
      setStatusMessage(updatedSession.isDirty ? 'Saved. Newer changes still need saving.' : 'Project saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The project could not be saved.')
      setStatusMessage('Save failed.')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (session) {
    return (
      <EditorWorkspace
        session={session}
        canSave={Boolean(projectAdapter.saveProject)}
        isSaving={saving}
        statusMessage={error ?? statusMessage}
        onSave={() => void save('save')}
        onSaveAs={() => void save('save-as')}
      />
    )
  }

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
