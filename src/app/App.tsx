import { useEffect, useRef, useState } from 'react'
import { openProjectSession, createUntitledProjectSession, updateProjectSessionDocument, type ProjectSession } from '../application/project-session'
import { canCloseAfterSave, requiresCloseConfirmation } from '../application/project-close-policy'
import { DocumentHistory } from '../application/document-history'
import { MAX_PNG_EXPORT_BYTES, type PngExportPort } from '../application/export-png-port'
import type { ProjectOpenPort } from '../application/project-open-port'
import type { ProjectSaveMode, ProjectSavePort } from '../application/project-save-port'
import type { SaveProjectSessionResult } from '../application/save-project-session'
import type { SceneDocument } from '../core/document/scene-document'
import { mergeSavedProjectSession, saveProjectSession } from '../application/save-project-session'
import EditorWorkspace, { type EditorWorkspaceHandle } from '../editor/workspace/EditorWorkspace'
import CloseProjectDialog, { type ClosePrompt } from './CloseProjectDialog'
import NewProjectScreen from './screens/NewProjectScreen'
import WelcomeScreen from './screens/WelcomeScreen'
import './app.css'

type AppProps = {
  projectAdapter: ProjectOpenPort & Partial<ProjectSavePort & PngExportPort>
}

function App({ projectAdapter }: AppProps) {
  const [screen, setScreen] = useState<'welcome' | 'new-project'>('welcome')
  const [session, setSession] = useState<ProjectSession | null>(null)
  const [editorSessionVersion, setEditorSessionVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('')
  const [closePrompt, setClosePrompt] = useState<ClosePrompt | null>(null)
  const sessionRef = useRef<ProjectSession | null>(null)
  const editorWorkspaceRef = useRef<EditorWorkspaceHandle>(null)
  const historyRef = useRef<DocumentHistory | null>(null)
  const savingRef = useRef(false)
  const exportingRef = useRef(false)
  const closePromptRef = useRef<ClosePrompt | null>(null)

  function updateClosePrompt(nextPrompt: ClosePrompt | null) {
    closePromptRef.current = nextPrompt
    setClosePrompt(nextPrompt)
  }

  function setActiveSession(nextSession: ProjectSession, resetEditorState = false) {
    if (resetEditorState) {
      setEditorSessionVersion((version) => version + 1)
      historyRef.current = new DocumentHistory(nextSession.isDirty ? null : nextSession.document)
    }
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
      if (editorWorkspaceRef.current && !editorWorkspaceRef.current.commitPendingEdits()) {
        setError('Fix or cancel the invalid Inspector value before closing.')
        controls.respondToCloseRequest(requestId, 'cancel')
        return
      }
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
    if (window.paintSMYS) return
    const protectBrowserClose = (event: BeforeUnloadEvent) => {
      if (editorWorkspaceRef.current && !editorWorkspaceRef.current.commitPendingEdits()) {
        event.preventDefault()
        event.returnValue = ''
        return
      }
      if (!requiresCloseConfirmation(sessionRef.current)) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protectBrowserClose)
    return () => window.removeEventListener('beforeunload', protectBrowserClose)
  }, [])

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
      setActiveSession(nextSession, true)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'The project could not be opened.')
    } finally {
      setBusy(false)
    }
  }

  function createProject(width: number, height: number) {
    setError(null)
    setStatusMessage('')
    setActiveSession(createUntitledProjectSession(width, height), true)
  }

  function publishDocumentChange(
    current: ProjectSession,
    document: SceneDocument,
    history: DocumentHistory,
    recordChange: boolean,
  ) {
    if (recordChange && !history.recordChange(current.document, document)) return
    const nextSession = updateProjectSessionDocument(current, document, history.isDirty(document))
    sessionRef.current = nextSession
    setSession(nextSession)
  }

  function updateDocument(sourceProjectId: string, previousDocument: SceneDocument, document: SceneDocument) {
    const current = sessionRef.current
    const history = historyRef.current
    if (
      !current || !history || current.projectId !== sourceProjectId ||
      current.document !== previousDocument || previousDocument === document
    ) return
    publishDocumentChange(current, document, history, true)
  }

  function navigateDocumentHistory(
    sourceProjectId: string,
    sourceDocument: SceneDocument,
    direction: 'undo' | 'redo',
  ) {
    const current = sessionRef.current
    const history = historyRef.current
    if (!current || !history || current.projectId !== sourceProjectId || current.document !== sourceDocument) return
    const document = direction === 'undo' ? history.undo(current.document) : history.redo(current.document)
    if (document) publishDocumentChange(current, document, history, false)
  }

  async function save(mode: ProjectSaveMode = 'save'): Promise<SaveProjectSessionResult | null> {
    if (!projectAdapter.saveProject || savingRef.current) return null
    const snapshot = sessionRef.current
    const snapshotHistory = historyRef.current
    if (!snapshot || !snapshotHistory) return null

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
      if (historyRef.current !== snapshotHistory) return null
      const updatedSession = mergeSavedProjectSession(snapshot, current, result.session)
      if (!updatedSession) return null
      snapshotHistory.markSaved(snapshot.document)
      const savedSession = { ...updatedSession, isDirty: snapshotHistory.isDirty(updatedSession.document) }
      setActiveSession(savedSession)
      setStatusMessage(savedSession.isDirty ? 'Saved. Newer changes still need saving.' : 'Project saved.')
      return { status: 'saved', session: savedSession }
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

  async function exportPng() {
    const snapshot = sessionRef.current
    const exportPort = projectAdapter.exportPng
    if (!snapshot || !exportPort || exportingRef.current) return

    exportingRef.current = true
    setExporting(true)
    setError(null)
    setStatusMessage('Exporting PNG…')
    try {
      const { createScenePngBlob } = await import('../editor/workspace/export-scene-png')
      const pngBlob = await createScenePngBlob(snapshot.document)
      if (pngBlob.size > MAX_PNG_EXPORT_BYTES) {
        throw new Error('The PNG is too large to export. Try a smaller Artboard.')
      }
      const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())
      const result = await exportPort({ projectName: snapshot.projectName, pngBytes })
      if (result.status === 'cancelled') {
        setStatusMessage('PNG export cancelled.')
      } else if (result.status === 'error') {
        setError(result.message)
        setStatusMessage('PNG export failed.')
      } else {
        setStatusMessage('PNG exported.')
      }
    } catch (exportError) {
      const message = exportError instanceof Error
        ? exportError.message
        : 'The Artboard could not be exported as PNG.'
      setError(message)
      setStatusMessage('PNG export failed.')
    } finally {
      exportingRef.current = false
      setExporting(false)
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
    if (editorWorkspaceRef.current && !editorWorkspaceRef.current.commitPendingEdits()) {
      updateClosePrompt({ ...request, message: 'Fix or cancel the invalid Inspector value before saving.' })
      return
    }
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
          ref={editorWorkspaceRef}
          key={editorSessionVersion}
          session={session}
          canSave={Boolean(projectAdapter.saveProject)}
          isSaving={saving}
          canExportPng={Boolean(projectAdapter.exportPng)}
          isExporting={exporting}
          statusMessage={error ?? statusMessage}
          isClosePromptOpen={closePrompt !== null}
          onSave={() => void save('save')}
          onSaveAs={() => void save('save-as')}
          onExportPng={() => void exportPng()}
          canUndo={historyRef.current?.canUndo ?? false}
          canRedo={historyRef.current?.canRedo ?? false}
          onUndo={() => navigateDocumentHistory(session.projectId, session.document, 'undo')}
          onRedo={() => navigateDocumentHistory(session.projectId, session.document, 'redo')}
          onDocumentChange={(previous, document) => updateDocument(session.projectId, previous, document)}
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
