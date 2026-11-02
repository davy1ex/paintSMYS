import { useEffect, useRef, useState } from 'react'
import { openProjectSession, createUntitledProjectSession, type ProjectSession } from '../application/project-session'
import { canCloseAfterSave, requiresCloseConfirmation } from '../application/project-close-policy'
import type { ProjectOpenPort } from '../application/project-open-port'
import type { ProjectSaveMode, ProjectSavePort } from '../application/project-save-port'
import type { SaveProjectSessionResult } from '../application/save-project-session'
import { mergeSavedProjectSession, saveProjectSession } from '../application/save-project-session'
import EditorWorkspace from '../editor/workspace/EditorWorkspace'
import CloseProjectDialog, { type ClosePrompt } from './CloseProjectDialog'
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
  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null)
  const sessionRef = useRef<ProjectSession | null>(null)
  const savingRef = useRef(false)
  const closePromptRef = useRef<ClosePrompt | null>(null)

  function updateClosePrompt(nextPrompt: ClosePrompt | null) {
    closePromptRef.current = nextPrompt
    setClosePrompt(nextPrompt)
  }

  function setActiveSession(nextSession: ProjectSession) {
    sessionRef.current = nextSession
    setSession(nextSession)
  }

  useEffect(() => {
    document.title = session ? `${session.projectName} — paintSMYS` : 'paintSMYS'
  }, [session])

  useEffect(() => {
    const controls = window.paintSMYS?.windowControls
    if (!controls) return

    const unsubscribeRequest = controls.onCloseRequest((requestId) => {
      if (closePromptRef.current) {
        if (closePromptRef.current.requestId !== requestId) controls.respondToCloseRequest(requestId, 'cancel')
        return
      }
      if (!requiresCloseConfirmation(sessionRef.current)) {
        controls.respondToCloseRequest(requestId, 'allow')
        return
      }
      updateClosePrompt({ requestId, message: '' })
    })
    const unsubscribeFailure = controls.onCloseRequestFailure(({ requestId, message }) => {
      if (closePromptRef.current?.requestId === requestId) updateClosePrompt(null)
      setError(message)
    })

    return () => {
      unsubscribeRequest()
      unsubscribeFailure()
    }
  }, [])

  useEffect(() => {
    if (window.paintSMYS || !requiresCloseConfirmation(session)) return
    const protectBrowserClose = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectBrowserClose)
    return () => window.removeEventListener('beforeunload', protectBrowserClose)
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

  async function save(mode: ProjectSaveMode = 'save'): Promise<SaveProjectSessionResult | null> {
    if (!projectAdapter.saveProject || savingRef.current) return null
    const snapshot = sessionRef.current
    if (!snapshot) return null

    savingRef.current = true
    setSaving(true)
    setError(null)
    setStatusMessage('Saving…')
    try {
      const result = await saveProjectSession(snapshot, projectAdapter as ProjectOpenPort & ProjectSavePort, mode)
      if (result.status === 'cancelled') {
        setStatusMessage('Save cancelled.')
        return result
      }
      if (result.status === 'error') {
        setError(result.message)
        setStatusMessage('Save failed.')
        return result
      }

      const current = sessionRef.current
      const updatedSession = mergeSavedProjectSession(snapshot, current, result.session)
      if (!updatedSession) return null
      setActiveSession(updatedSession)
      setStatusMessage(updatedSession.isDirty ? 'Saved. Newer changes still need saving.' : 'Project saved.')
      return { status: 'saved', session: updatedSession }
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : 'The project could not be saved.'
      setError(message)
      setStatusMessage('Save failed.')
      return { status: 'error', message }
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function finishClose(decision: 'allow' | 'cancel') {
    const request = closePromptRef.current
    if (!request) return
    if (decision === 'allow' && savingRef.current) return
    updateClosePrompt(null)
    window.paintSMYS?.windowControls.respondToCloseRequest(request.requestId, decision)
  }

  async function saveAndClose() {
    const request = closePromptRef.current
    if (!request || savingRef.current) return
    updateClosePrompt({ ...request, message: '' })
    const result = await save('save')
    if (closePromptRef.current?.requestId !== request.requestId) return

    if (canCloseAfterSave(result, sessionRef.current)) {
      finishClose('allow')
      return
    }

    const message = result?.status === 'error'
      ? result.message
      : result?.status === 'cancelled'
        ? 'Save was cancelled. The window will stay open.'
        : result?.status === 'saved'
          ? 'The document changed while it was saving. Save again to include the newer changes.'
          : 'The project could not be saved. The window will stay open.'
    updateClosePrompt({ requestId: request.requestId, message })
  }

  if (session) {
    return (
      <>
        <EditorWorkspace
          session={session}
          canSave={Boolean(projectAdapter.saveProject)}
          isSaving={saving}
          statusMessage={error ?? statusMessage}
          onSave={() => void save('save')}
          onSaveAs={() => void save('save-as')}
        />
        <CloseProjectDialog
          request={closePrompt}
          projectName={session.projectName}
          isSaving={saving}
          onSave={() => void saveAndClose()}
          onDontSave={() => finishClose('allow')}
          onCancel={() => finishClose('cancel')}
        />
      </>
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
