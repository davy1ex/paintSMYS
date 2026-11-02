import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { addRectangle, removeObject, type RectangleGeometry, type SceneDocument } from '../../core/document/scene-document'
import type { ProjectSession } from '../../application/project-session'
import type { ProjectSaveMode } from '../../application/project-save-port'
import { findTopmostRectangleAtPoint, isGestureLongEnough, normalizeRectangle, transformPoint, type NormalizedRectangle, type Point } from './rectangle-geometry'
import EditorMenuBar from './EditorMenuBar'
import ToolPanel from './ToolPanel'
import './editor-workspace.css'

type ActiveTool = 'select' | 'rectangle'

type EditorWorkspaceProps = {
  session: ProjectSession
  canSave: boolean
  isSaving: boolean
  statusMessage: string
  isClosePromptOpen: boolean
  onSave: (mode?: ProjectSaveMode) => void
  onSaveAs: () => void
  onDocumentChange: (document: SceneDocument) => void
}

type RectangleGesture = {
  pointerId: number
  pointerType: string
  startArtboard: Point
  startClient: Point
  lastClient: Point
}

function pointerToArtboard(svg: SVGSVGElement, point: Point): Point | null {
  const screenTransform = svg.getScreenCTM()
  if (!screenTransform) return null
  return transformPoint(point, screenTransform.inverse())
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select') !== null
}

function EditorWorkspace({ session, canSave, isSaving, statusMessage, isClosePromptOpen, onSave, onSaveAs, onDocumentChange }: EditorWorkspaceProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<RectangleGesture | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [mockActionMessage, setMockActionMessage] = useState('')
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [preview, setPreview] = useState<NormalizedRectangle | null>(null)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
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
  const selectedObject = document.objects.find((object) => object.id === selectedObjectId) ?? null

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

  useEffect(() => {
    const updatePreview = (clientX: number, clientY: number, pointerId?: number) => {
      const gesture = gestureRef.current
      const svg = svgRef.current
      if (!gesture || !svg || (pointerId !== undefined && gesture.pointerId !== pointerId)) return
      if (gesture.lastClient.x === clientX && gesture.lastClient.y === clientY) return
      gesture.lastClient = { x: clientX, y: clientY }
      const end = pointerToArtboard(svg, { x: clientX, y: clientY })
      if (end) setPreview(normalizeRectangle(gesture.startArtboard, end))
    }

    const finishGesture = (clientX: number, clientY: number, pointerId?: number) => {
      const gesture = gestureRef.current
      const svg = svgRef.current
      if (!gesture || !svg || (pointerId !== undefined && gesture.pointerId !== pointerId)) return
      const end = pointerToArtboard(svg, { x: clientX, y: clientY })
      gestureRef.current = null
      setPreview(null)
      if (!end || !isGestureLongEnough(gesture.startClient, { x: clientX, y: clientY })) return

      const rectangle: RectangleGeometry = normalizeRectangle(gesture.startArtboard, end)
      if (rectangle.width <= 0 || rectangle.height <= 0 || !Object.values(rectangle).every(Number.isFinite)) return
      onDocumentChange(addRectangle(document, rectangle))
    }

    const handlePointerMove = (event: PointerEvent) => {
      updatePreview(event.clientX, event.clientY, event.pointerId)
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (gestureRef.current?.pointerType !== 'mouse') return
      updatePreview(event.clientX, event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      finishGesture(event.clientX, event.clientY, event.pointerId)
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (gestureRef.current?.pointerType !== 'mouse') return
      finishGesture(event.clientX, event.clientY)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      if (gestureRef.current?.pointerId !== event.pointerId) return
      gestureRef.current = null
      setPreview(null)
    }

    // Listen at window level so the captured drag keeps updating even when the
    // pointer leaves the SVG. Mouse drags use mouse events; pen and touch use pointers.
    globalThis.window.addEventListener('pointermove', handlePointerMove, true)
    globalThis.window.addEventListener('pointerup', handlePointerUp, true)
    globalThis.window.addEventListener('pointercancel', handlePointerCancel, true)
    globalThis.window.addEventListener('mousemove', handleMouseMove, true)
    globalThis.window.addEventListener('mouseup', handleMouseUp, true)
    return () => {
      globalThis.window.removeEventListener('pointermove', handlePointerMove, true)
      globalThis.window.removeEventListener('pointerup', handlePointerUp, true)
      globalThis.window.removeEventListener('pointercancel', handlePointerCancel, true)
      globalThis.window.removeEventListener('mousemove', handleMouseMove, true)
      globalThis.window.removeEventListener('mouseup', handleMouseUp, true)
    }
  }, [document, onDocumentChange])

  useEffect(() => {
    const cancelDrawing = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const gesture = gestureRef.current
      if (!gesture) return
      event.preventDefault()
      gestureRef.current = null
      setPreview(null)
      const svg = svgRef.current
      if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
    }
    globalThis.document.addEventListener('keydown', cancelDrawing)
    return () => globalThis.document.removeEventListener('keydown', cancelDrawing)
  }, [])

  useEffect(() => {
    if (selectedObjectId && !document.objects.some((object) => object.id === selectedObjectId)) {
      setSelectedObjectId(null)
    }
  }, [document, selectedObjectId])

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if (
        isClosePromptOpen || globalThis.document.querySelector('dialog[open]') ||
        event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)
      ) return
      if (event.key !== 'Delete' && event.key !== 'Backspace') return

      event.preventDefault()
      if (!selectedObjectId) return

      if (!document.objects.some((object) => object.id === selectedObjectId)) {
        setSelectedObjectId(null)
        return
      }

      setSelectedObjectId(null)
      onDocumentChange(removeObject(document, selectedObjectId))
    }

    globalThis.document.addEventListener('keydown', handleDelete)
    return () => globalThis.document.removeEventListener('keydown', handleDelete)
  }, [document, isClosePromptOpen, onDocumentChange, selectedObjectId])

  useEffect(() => {
    if (activeTool === 'rectangle') return
    const gesture = gestureRef.current
    if (!gesture) return
    gestureRef.current = null
    setPreview(null)
    const svg = svgRef.current
    if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
  }, [activeTool])

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return

    if (activeTool === 'select') {
      const point = pointerToArtboard(event.currentTarget, { x: event.clientX, y: event.clientY })
      if (point) setSelectedObjectId(findTopmostRectangleAtPoint(document.objects, point))
      return
    }

    if (activeTool !== 'rectangle') return
    const startClient = { x: event.clientX, y: event.clientY }
    const startArtboard = pointerToArtboard(event.currentTarget, startClient)
    if (!startArtboard) return

    gestureRef.current = { pointerId: event.pointerId, pointerType: event.pointerType, startArtboard, startClient, lastClient: startClient }
    setPreview(null)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

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
              className={`editor-artboard${activeTool === 'rectangle' ? ' editor-artboard--drawing' : ''}`}
              aria-label={`Artboard ${artboard.width} by ${artboard.height} pixels`}
              style={{ width: boardWidth, height: boardHeight }}
            >
              <svg
                ref={svgRef}
                className="scene-svg"
                viewBox={`0 0 ${artboard.width} ${artboard.height}`}
                role="img"
                aria-label="Scene contents"
                onPointerDown={handlePointerDown}
              >
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
                {selectedObject && (
                  <>
                    <rect
                      x={selectedObject.x}
                      y={selectedObject.y}
                      width={selectedObject.width}
                      height={selectedObject.height}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={4}
                      strokeDasharray="1 3"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                    <rect
                      x={selectedObject.x}
                      y={selectedObject.y}
                      width={selectedObject.width}
                      height={selectedObject.height}
                      fill="none"
                      stroke="#000080"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                  </>
                )}
                {preview && preview.width > 0 && preview.height > 0 && (
                  <rect
                    x={preview.x}
                    y={preview.y}
                    width={preview.width}
                    height={preview.height}
                    fill="#000080"
                    fillOpacity={0.12}
                    stroke="#000080"
                    strokeDasharray="4 3"
                    pointerEvents="none"
                    aria-hidden="true"
                  />
                )}
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
