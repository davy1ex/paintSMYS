import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { addRectangle, moveObject, removeObject, type RectangleGeometry, type SceneDocument, type SceneObject } from '../../core/document/scene-document'
import type { ProjectSession } from '../../application/project-session'
import type { ProjectSaveMode } from '../../application/project-save-port'
import { findTopmostRectangleAtPoint, isGestureLongEnough, normalizeRectangle, transformPoint, transformVector, translateRectangle, type NormalizedRectangle, type Point } from './rectangle-geometry'
import EditorMenuBar from './EditorMenuBar'
import ToolPanel from './ToolPanel'
import './editor-workspace.css'

type ActiveTool = 'select' | 'rectangle'

type EditorWorkspaceProps = {
  session: ProjectSession
  canSave: boolean
  isSaving: boolean
  canUndo: boolean
  canRedo: boolean
  statusMessage: string
  isClosePromptOpen: boolean
  onSave: (mode?: ProjectSaveMode) => void
  onSaveAs: () => void
  onUndo: () => void
  onRedo: () => void
  onDocumentChange: (previousDocument: SceneDocument, document: SceneDocument) => void
}

type GestureBase = {
  pointerId: number
  pointerType: string
  projectId: string
  sourceDocument: SceneDocument
  startClient: Point
  lastClient: Point
}

type RectangleDrawGesture = GestureBase & {
  kind: 'draw'
  startArtboard: Point
}

type RectangleMoveGesture = GestureBase & {
  kind: 'move'
  objectId: string
  originalX: number
  originalY: number
  sceneDelta: Point
}

type RectangleGesture = RectangleDrawGesture | RectangleMoveGesture

function pointerToArtboard(svg: SVGSVGElement, point: Point): Point | null {
  const screenTransform = svg.getScreenCTM()
  if (!screenTransform) return null
  return transformPoint(point, screenTransform.inverse())
}

function pointerDeltaToArtboard(svg: SVGSVGElement, delta: Point): Point | null {
  const screenTransform = svg.getScreenCTM()
  if (!screenTransform) return null
  return transformVector(delta, screenTransform.inverse())
}

function findObjectAtClientPoint(svg: SVGSVGElement | null, objects: SceneObject[], clientPoint: Point): string | null {
  if (!svg) return null
  const bounds = svg.getBoundingClientRect()
  if (
    clientPoint.x < bounds.left || clientPoint.x > bounds.right ||
    clientPoint.y < bounds.top || clientPoint.y > bounds.bottom
  ) return null

  const scenePoint = pointerToArtboard(svg, clientPoint)
  return scenePoint ? findTopmostRectangleAtPoint(objects, scenePoint) : null
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select') !== null
}

function EditorWorkspace({
  session,
  canSave,
  isSaving,
  canUndo,
  canRedo,
  statusMessage,
  isClosePromptOpen,
  onSave,
  onSaveAs,
  onUndo,
  onRedo,
  onDocumentChange,
}: EditorWorkspaceProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<RectangleGesture | null>(null)
  const pointerClientRef = useRef<Point | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [mockActionMessage, setMockActionMessage] = useState('')
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [preview, setPreview] = useState<NormalizedRectangle | null>(null)
  const [movePreview, setMovePreview] = useState<{ objectId: string; x: number; y: number } | null>(null)
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [isMovingObject, setIsMovingObject] = useState(false)
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
      if (
        isClosePromptOpen || globalThis.document.querySelector('dialog[open]') ||
        isEditableTarget(event.target) || event.altKey || event.isComposing
      ) return
      if (event.ctrlKey === event.metaKey) return

      const key = event.key.toLowerCase()
      // `key` changes with the selected layout; `code` identifies the physical key.
      const isZKey = event.code === 'KeyZ' || key === 'z' || key === 'я'
      const isYKey = event.code === 'KeyY' || key === 'y' || key === 'н'
      if ((event.ctrlKey || event.metaKey) && isZKey) {
        if (event.shiftKey && canRedo) {
          event.preventDefault()
          onRedo()
        } else if (!event.shiftKey && canUndo) {
          event.preventDefault()
          onUndo()
        }
        return
      }
      if (event.ctrlKey && !event.shiftKey && isYKey && canRedo) {
        event.preventDefault()
        onRedo()
        return
      }
      if (canSave && !event.shiftKey && (event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        if (!isSaving) onSave()
      }
    }
    globalThis.document.addEventListener('keydown', handleShortcut)
    return () => globalThis.document.removeEventListener('keydown', handleShortcut)
  }, [canRedo, canSave, canUndo, isClosePromptOpen, isSaving, onRedo, onSave, onUndo])

  useEffect(() => {
    const updateHover = (clientPoint: Point, objects: SceneObject[] = document.objects) => {
      const objectId = activeTool === 'select'
        ? findObjectAtClientPoint(svgRef.current, objects, clientPoint)
        : null
      setHoveredObjectId(objectId)
    }

    const updatePreview = (clientX: number, clientY: number, pointerId?: number) => {
      const gesture = gestureRef.current
      const svg = svgRef.current
      if (!gesture || !svg || (pointerId !== undefined && gesture.pointerId !== pointerId)) return
      if (gesture.lastClient.x === clientX && gesture.lastClient.y === clientY) return
      const nextClient = { x: clientX, y: clientY }

      if (gesture.kind === 'draw') {
        gesture.lastClient = nextClient
        const end = pointerToArtboard(svg, nextClient)
        if (end) setPreview(normalizeRectangle(gesture.startArtboard, end))
        return
      }

      const sceneDelta = pointerDeltaToArtboard(svg, {
        x: clientX - gesture.lastClient.x,
        y: clientY - gesture.lastClient.y,
      })
      if (!sceneDelta) return
      gesture.lastClient = nextClient
      gesture.sceneDelta = {
        x: gesture.sceneDelta.x + sceneDelta.x,
        y: gesture.sceneDelta.y + sceneDelta.y,
      }
      if (isGestureLongEnough(gesture.startClient, nextClient)) {
        const position = translateRectangle(
          { x: gesture.originalX, y: gesture.originalY },
          gesture.sceneDelta,
        )
        setMovePreview({ objectId: gesture.objectId, ...position })
      } else {
        setMovePreview(null)
      }
    }

    const finishGesture = (clientX: number, clientY: number, pointerId?: number) => {
      const gesture = gestureRef.current
      const svg = svgRef.current
      if (!gesture || !svg || (pointerId !== undefined && gesture.pointerId !== pointerId)) return
      pointerClientRef.current = { x: clientX, y: clientY }
      updatePreview(clientX, clientY, pointerId)
      gestureRef.current = null
      setPreview(null)
      setMovePreview(null)

      if (gesture.kind === 'move') {
        const shouldMove = isGestureLongEnough(gesture.startClient, { x: clientX, y: clientY })
        setIsMovingObject(false)
        const moved = shouldMove
          ? moveObject(document, gesture.objectId, {
            x: gesture.originalX + gesture.sceneDelta.x,
            y: gesture.originalY + gesture.sceneDelta.y,
          })
          : document
        updateHover({ x: clientX, y: clientY }, moved.objects)
        if (moved !== document) onDocumentChange(document, moved)
        return
      }

      setIsMovingObject(false)
      setHoveredObjectId(null)
      if (!isGestureLongEnough(gesture.startClient, { x: clientX, y: clientY })) return

      const end = pointerToArtboard(svg, { x: clientX, y: clientY })
      if (!end) return
      const rectangle: RectangleGeometry = normalizeRectangle(gesture.startArtboard, end)
      if (rectangle.width <= 0 || rectangle.height <= 0 || !Object.values(rectangle).every(Number.isFinite)) return
      onDocumentChange(document, addRectangle(document, rectangle))
    }

    const handlePointerMove = (event: PointerEvent) => {
      const clientPoint = { x: event.clientX, y: event.clientY }
      pointerClientRef.current = clientPoint
      if (gestureRef.current) updatePreview(event.clientX, event.clientY, event.pointerId)
      else if (event.pointerType !== 'touch') updateHover(clientPoint)
    }

    const handleMouseMove = (event: MouseEvent) => {
      const clientPoint = { x: event.clientX, y: event.clientY }
      pointerClientRef.current = clientPoint
      if (gestureRef.current?.pointerType === 'mouse') updatePreview(event.clientX, event.clientY)
      else if (!gestureRef.current) updateHover(clientPoint)
    }

    const handlePointerUp = (event: PointerEvent) => {
      finishGesture(event.clientX, event.clientY, event.pointerId)
    }

    const handleMouseUp = (event: MouseEvent) => {
      if (gestureRef.current?.pointerType !== 'mouse') return
      finishGesture(event.clientX, event.clientY)
    }

    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = gestureRef.current
      if (gesture?.pointerId !== event.pointerId) return
      gestureRef.current = null
      setPreview(null)
      setMovePreview(null)
      setIsMovingObject(false)
      pointerClientRef.current = gesture.lastClient
      updateHover(gesture.lastClient)
    }

    // Listen at window level so pointer capture keeps updating outside the SVG.
    // Mouse events remain as a fallback for hosts that do not dispatch Pointer Events.
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
  }, [activeTool, document, onDocumentChange])

  useEffect(() => {
    const cancelGesture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const gesture = gestureRef.current
      if (!gesture) return
      event.preventDefault()
      gestureRef.current = null
      setPreview(null)
      setMovePreview(null)
      setIsMovingObject(false)
      pointerClientRef.current = gesture.lastClient
      setHoveredObjectId(activeTool === 'select'
        ? findObjectAtClientPoint(svgRef.current, document.objects, gesture.lastClient)
        : null)
      const svg = svgRef.current
      if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
    }
    globalThis.document.addEventListener('keydown', cancelGesture)
    return () => globalThis.document.removeEventListener('keydown', cancelGesture)
  }, [activeTool, document])

  useEffect(() => {
    if (!isMovingObject) return
    const body = globalThis.document.body
    body.classList.add('editor-workspace--moving')
    return () => body.classList.remove('editor-workspace--moving')
  }, [isMovingObject])

  useEffect(() => () => {
    const gesture = gestureRef.current
    gestureRef.current = null
    const svg = svgRef.current
    if (gesture && svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
  }, [])

  useEffect(() => {
    const gesture = gestureRef.current
    const gestureUsesActiveTool = !gesture || (gesture.kind === 'draw'
      ? activeTool === 'rectangle'
      : activeTool === 'select')
    const gestureUsesCurrentSession = !gesture || (
      gesture.projectId === session.projectId && gesture.sourceDocument === document
    )
    if (gesture && (!gestureUsesActiveTool || !gestureUsesCurrentSession)) {
      gestureRef.current = null
      setPreview(null)
      setMovePreview(null)
      setIsMovingObject(false)
      const svg = svgRef.current
      if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId)
    }

    const clientPoint = pointerClientRef.current
    setHoveredObjectId(activeTool === 'select' && clientPoint
      ? findObjectAtClientPoint(svgRef.current, document.objects, clientPoint)
      : null)
  }, [activeTool, document, session.projectId])

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
      onDocumentChange(document, removeObject(document, selectedObjectId))
    }

    globalThis.document.addEventListener('keydown', handleDelete)
    return () => globalThis.document.removeEventListener('keydown', handleDelete)
  }, [document, isClosePromptOpen, onDocumentChange, selectedObjectId])

  function handlePointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0 || !event.isPrimary || gestureRef.current) return
    const startClient = { x: event.clientX, y: event.clientY }
    pointerClientRef.current = startClient

    if (activeTool === 'select') {
      const objectId = findObjectAtClientPoint(event.currentTarget, document.objects, startClient)
      setSelectedObjectId(objectId)
      setHoveredObjectId(objectId)
      setPreview(null)
      setMovePreview(null)
      setIsMovingObject(Boolean(objectId))
      if (!objectId) return

      const object = document.objects.find((candidate) => candidate.id === objectId)
      if (!object) return
      gestureRef.current = {
        kind: 'move',
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        projectId: session.projectId,
        sourceDocument: document,
        objectId,
        originalX: object.x,
        originalY: object.y,
        startClient,
        lastClient: startClient,
        sceneDelta: { x: 0, y: 0 },
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      return
    }

    if (activeTool !== 'rectangle') return
    const startArtboard = pointerToArtboard(event.currentTarget, startClient)
    if (!startArtboard) return

    setHoveredObjectId(null)
    setIsMovingObject(false)
    gestureRef.current = {
      kind: 'draw',
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      projectId: session.projectId,
      sourceDocument: document,
      startArtboard,
      startClient,
      lastClient: startClient,
    }
    setPreview(null)
    setMovePreview(null)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleLostPointerCapture(event: ReactPointerEvent<SVGSVGElement>) {
    const gesture = gestureRef.current
    if (gesture?.pointerId !== event.pointerId) return
    gestureRef.current = null
    setPreview(null)
    setMovePreview(null)
    setIsMovingObject(false)
    pointerClientRef.current = gesture.lastClient
    setHoveredObjectId(activeTool === 'select'
      ? findObjectAtClientPoint(svgRef.current, document.objects, gesture.lastClient)
      : null)
  }

  return (
    <main className="editor-shell">
      <EditorMenuBar
        canSave={canSave}
        isSaving={isSaving}
        canUndo={canUndo}
        canRedo={canRedo}
        onSave={() => onSave('save')}
        onSaveAs={onSaveAs}
        onUndo={onUndo}
        onRedo={onRedo}
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
              className={`editor-artboard${activeTool === 'rectangle' ? ' editor-artboard--drawing' : ''}${activeTool === 'select' && hoveredObjectId ? ' editor-artboard--move-target' : ''}${isMovingObject ? ' editor-artboard--moving' : ''}`}
              aria-label={`Artboard ${artboard.width} by ${artboard.height} pixels`}
              style={{ width: boardWidth, height: boardHeight }}
            >
              <svg
                ref={svgRef}
                className={`scene-svg${activeTool === 'rectangle' ? ' scene-svg--drawing' : ''}${activeTool === 'select' && hoveredObjectId ? ' scene-svg--move-target' : ''}${isMovingObject ? ' scene-svg--moving' : ''}`}
                viewBox={`0 0 ${artboard.width} ${artboard.height}`}
                role="img"
                aria-label="Scene contents"
                onPointerDown={handlePointerDown}
                onLostPointerCapture={handleLostPointerCapture}
              >
                <rect width={artboard.width} height={artboard.height} fill={artboard.backgroundColor} />
                {document.objects.map((object) => {
                  const position = movePreview?.objectId === object.id ? movePreview : object
                  return (
                    <rect
                      key={object.id}
                      x={position.x}
                      y={position.y}
                      width={object.width}
                      height={object.height}
                      fill={object.fill}
                      stroke={object.stroke}
                      strokeWidth={object.strokeWidth}
                    />
                  )
                })}
                {selectedObject && (
                  <>
                    <rect
                      x={movePreview?.objectId === selectedObject.id ? movePreview.x : selectedObject.x}
                      y={movePreview?.objectId === selectedObject.id ? movePreview.y : selectedObject.y}
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
                      x={movePreview?.objectId === selectedObject.id ? movePreview.x : selectedObject.x}
                      y={movePreview?.objectId === selectedObject.id ? movePreview.y : selectedObject.y}
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
