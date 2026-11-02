import { useEffect, useRef, useState } from 'react'
import type { ProjectSession } from '../../application/project-session'
import type { ProjectSaveMode } from '../../application/project-save-port'
import EditorMenuBar from './EditorMenuBar'
import ToolPanel from './ToolPanel'
import './editor-workspace.css'

type ActiveTool = 'select' | 'rectangle'

type EditorWorkspaceProps = {
  session: ProjectSession
  canSave: boolean
  isSaving: boolean
  statusMessage: string
  onSave: (mode?: ProjectSaveMode) => void
  onSaveAs: () => void
}

function EditorWorkspace({ session, canSave, isSaving, statusMessage, onSave, onSaveAs }: EditorWorkspaceProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [mockActionMessage, setMockActionMessage] = useState('')
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const { document } = session
  const { artboard } = document
  const fitScale = Math.min(
    viewportSize.width / artboard.width || 0,
    viewportSize.height / artboard.height || 0,
  )
  const scale = Math.min(1, fitScale)
  const boardWidth = Math.max(0, artboard.width * scale)
  const boardHeight = Math.max(0, artboard.height * scale)
  const zoomLabel = scale > 0 ? `${Math.round(scale * 100)}%` : 'Fit'

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (canSave && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!isSaving) onSave()
      }
    }
    globalThis.document.addEventListener('keydown', handleShortcut)
    return () => globalThis.document.removeEventListener('keydown', handleShortcut)
  }, [canSave, isSaving, onSave])

  return (
    <main className="editor-shell">
      <EditorMenuBar
        canSave={canSave}
        isSaving={isSaving}
        onSave={() => onSave('save')}
        onSaveAs={onSaveAs}
        onMockAction={(action) => setMockActionMessage(`${action} — mock action`)}
      />
      <div className="editor-toolbar" aria-label="Editor status">
        <div className="editor-project-mark" aria-hidden="true">P</div>
        <strong className="editor-project-name">{session.projectName}</strong>
        <span className="editor-project-status">{session.isDirty ? 'Unsaved session' : 'Saved project'}</span>
        <span className="editor-toolbar-spacer" />
        <span className="editor-dimensions">{artboard.width} × {artboard.height} px</span>
      </div>
      <div className="editor-main">
        <ToolPanel activeTool={activeTool} onToolChange={setActiveTool} />
        <section className="editor-stage" aria-label="Artboard workspace">
          <div className="editor-canvas-wrap" ref={canvasRef}>
            <div
              className="editor-artboard"
              aria-label={`Artboard ${artboard.width} by ${artboard.height} pixels`}
              style={{ width: boardWidth, height: boardHeight }}
            >
              <svg className="scene-svg" viewBox={`0 0 ${artboard.width} ${artboard.height}`} role="img" aria-label="Scene contents">
                <rect width={artboard.width} height={artboard.height} fill={artboard.backgroundColor} />
                {document.objects.map((object) => (
                  <rect
                    key={object.id}
                    x={object.x}
                    y={object.y}
                    width={object.width}
                    height={object.height}
                    fill={object.fill}
                    stroke={object.stroke}
                    strokeWidth={object.strokeWidth}
                  />
                ))}
              </svg>
            </div>
          </div>
          <div className="editor-stage__footer"><span>{zoomLabel}</span><span>{document.objects.length} objects</span></div>
        </section>
        <aside className="property-inspector" aria-label="Property Inspector">
          <div className="inspector-title">Scene Properties</div>
          <div className="inspector-section-label">ARTBOARD</div>
          <dl className="inspector-list">
            <div><dt>Width</dt><dd>{artboard.width} px</dd></div>
            <div><dt>Height</dt><dd>{artboard.height} px</dd></div>
            <div><dt>Background</dt><dd><span className="color-chip" style={{ backgroundColor: artboard.backgroundColor }} />{artboard.backgroundColor}</dd></div>
          </dl>
          <div className="inspector-divider" />
          <div className="inspector-section-label">SCENE</div>
          <dl className="inspector-list">
            <div><dt>Objects</dt><dd>{document.objects.length}</dd></div>
            <div><dt>Scene ID</dt><dd className="inspector-id" title={document.id}>{document.id.slice(0, 8)}…</dd></div>
          </dl>
          <div className="inspector-empty">Select an object to inspect its properties.</div>
        </aside>
      </div>
      <footer className="editor-statusbar">
        <span>{session.projectRoot ? 'Project opened from folder' : session.isDirty ? 'Project folder not set' : 'Opened in browser'}</span>
        <span className="editor-status-message" role="status" aria-live="polite" aria-atomic="true">{statusMessage || mockActionMessage || (isSaving ? 'Saving…' : '')}</span>
        <span>paintSMYS</span>
      </footer>
    </main>
  )
}

export default EditorWorkspace
