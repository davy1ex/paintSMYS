import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { addRectangle, addTextObject, DEFAULT_TEXT_FONT_SIZE, MAX_TEXT_LENGTH, moveObject, removeObject, updateRectangleObjectProperties, updateTextObject, updateTextObjectProperties, type RectangleGeometry, type RectangleObjectProperties, type SceneDocument, type SceneObject, type TextObjectProperties } from '../../core/document/scene-document'
import type { ProjectSession } from '../../application/project-session'
import type { ProjectSaveMode } from '../../application/project-save-port'
import { findTopmostObjectAtPoint, getSceneObjectBounds, isGestureLongEnough, normalizeRectangle, transformPoint, transformVector, translateRectangle, type NormalizedRectangle, type Point } from './rectangle-geometry'
import EditorMenuBar from './EditorMenuBar'
import PropertyInspector, { type PropertyInspectorHandle } from './PropertyInspector'
import { SceneSvgContent } from './SceneSvgContent'
import ToolPanel from './ToolPanel'
import './editor-workspace.css'

type ActiveTool = 'select' | 'rectangle' | 'text'

export type EditorWorkspaceHandle = {
  commitPendingEdits: () => boolean
}

type EditorWorkspaceProps = {
  session: ProjectSession
  canSave: boolean
  isSaving: boolean
  canExportPng: boolean
  canUndo: boolean
  canRedo: boolean
  statusMessage: string
  isExporting: boolean
  isClosePromptOpen: boolean
  onSave: (mode?: ProjectSaveMode) => void
  onSaveAs: () => void
  onExportPng: () => void
  onUndo: () => void
  onRedo: () => void
  onDocumentChange: (previousDocument: SceneDocument, document: SceneDocument) => void
}

type TextDraft = {
  mode: 'create' | 'edit'
  x: number
  y: number
  text: string
  fontFamily?: string
  fontSize?: number
  objectId?: string
  originalText?: string
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

type ObjectMoveGesture = GestureBase & {
  kind: 'move'
  objectId: string
  originalX: number
  originalY: number
  sceneDelta: Point
}

type EditorGesture = RectangleDrawGesture | ObjectMoveGesture

const RECTANGLE_HIT_SLOP_CSS_PIXELS = 8

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

  const screenTransform = svg.getScreenCTM()
  if (!screenTransform) return null
  const inverse = screenTransform.inverse()
  const scenePoint = transformPoint(clientPoint, inverse)
  const horizontalSlop = transformVector({ x: RECTANGLE_HIT_SLOP_CSS_PIXELS, y: 0 }, inverse)
  const verticalSlop = transformVector({ x: 0, y: RECTANGLE_HIT_SLOP_CSS_PIXELS }, inverse)
  const tolerance = {
    x: Math.abs(horizontalSlop.x) + Math.abs(verticalSlop.x),
    y: Math.abs(horizontalSlop.y) + Math.abs(verticalSlop.y),
  }
  return findTopmostObjectAtPoint(objects, scenePoint, tolerance)
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.closest('input, textarea, select') !== null
}

const EditorWorkspace = forwardRef<EditorWorkspaceHandle, EditorWorkspaceProps>(function EditorWorkspace({
  session,
  canSave,
  isSaving,
  canExportPng,
  canUndo,
  canRedo,
  statusMessage,
  isExporting,
  isClosePromptOpen,
  onSave,
  onSaveAs,
  onExportPng,
  onUndo,
  onRedo,
  onDocumentChange,
}, ref) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gestureRef = useRef<EditorGesture | null>(null)
  const textDraftRef = useRef<TextDraft | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inspectorRef = useRef<PropertyInspectorHandle>(null)
  const documentRef = useRef(session.document)
  const pointerClientRef = useRef<Point | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [mockActionMessage, setMockActionMessage] = useState('')
  const [activeTool, setActiveTool] = useState<ActiveTool>('select')
  const [preview, setPreview] = useState<NormalizedRectangle | null>(null)
  const [movePreview, setMovePreview] = useState<{ objectId: string; x: number; y: number } | null>(null)
  const [hoveredObjectId, setHoveredObjectId] = useState<string | null>(null)
  const [isMovingObject, setIsMovingObject] = useState(false)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)
  const [textDraft, setTextDraft] = useState<TextDraft | null>(null)
  const { document } = session
  documentRef.current = document
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
  const selectedBounds = selectedObject ? getSceneObjectBounds(selectedObject) : null
  const visibleSelectedBounds = selectedObject && selectedBounds
    ? {
      ...selectedBounds,
      x: movePreview?.objectId === selectedObject.id ? movePreview.x : selectedObject.x,
      y: movePreview?.objectId === selectedObject.id ? movePreview.y : selectedObject.y,
    }
    : null
  const setActiveTextDraft = (nextDraft: TextDraft | null) => {
    textDraftRef.current = nextDraft
    setTextDraft(nextDraft)
  }

  function publishDocumentChange(nextDocument: SceneDocument) {
    const previousDocument = documentRef.current
    if (previousDocument === nextDocument) return
    documentRef.current = nextDocument
    onDocumentChange(previousDocument, nextDocument)
  }

  function updateRectangleProperties(objectId: string, properties: RectangleObjectProperties): string | null {
    try {
      publishDocumentChange(updateRectangleObjectProperties(documentRef.current, objectId, properties))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'The Rectangle property is invalid.'
    }
  }

  function updateTextProperties(objectId: string, properties: TextObjectProperties): string | null {
    try {
      publishDocumentChange(updateTextObjectProperties(documentRef.current, objectId, properties))
      return null
    } catch (error) {
      return error instanceof Error ? error.message : 'The Text property is invalid.'
    }
  }

  function commitTextDraft(): boolean {
    const draft = textDraftRef.current
    if (!draft) return true
    setActiveTextDraft(null)

    if (draft.mode === 'create') {
      if (!draft.text.trim()) return true
      const nextDocument = addTextObject(documentRef.current, { x: draft.x, y: draft.y, text: draft.text })
      const created = nextDocument.objects[nextDocument.objects.length - 1]
      setSelectedObjectId(created.id)
      publishDocumentChange(nextDocument)
      return true
    }

    if (draft.objectId && draft.text !== draft.originalText) {
      publishDocumentChange(updateTextObject(documentRef.current, draft.objectId, draft.text))
    }
    if (draft.objectId) setSelectedObjectId(draft.objectId)
    return true
  }

  function cancelTextDraft() {
    const draft = textDraftRef.current
    if (!draft) return
    setActiveTextDraft(null)
    setSelectedObjectId(draft.mode === 'edit' ? draft.objectId ?? null : null)
  }

  useImperativeHandle(ref, () => ({ commitPendingEdits }), [document, onDocumentChange])

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
    if (textDraft) textareaRef.current?.focus()
  }, [Boolean(textDraft)])

  function handleSave(mode: ProjectSaveMode = 'save') {
    if (!commitPendingEdits()) return
    onSave(mode)
  }

  function handleSaveAs() {
    if (!commitPendingEdits()) return
    onSaveAs()
  }

  function handleExportPng() {
    if (!commitPendingEdits()) return
    onExportPng()
  }

  function commitPendingEdits(): boolean {
    if (inspectorRef.current && !inspectorRef.current.commitPendingEdits()) return false
    return commitTextDraft()
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        isClosePromptOpen || globalThis.document.querySelector('dialog[open]') ||
        event.altKey || event.isComposing
      ) return
      if (event.ctrlKey === event.metaKey) return

      const key = event.key.toLowerCase()
      if (canSave && !event.shiftKey && (event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        if (!isSaving) handleSave()
        return
      }
      if (isEditableTarget(event.target)) return

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
    }
    globalThis.document.addEventListener('keydown', handleShortcut)
    return () => globalThis.document.removeEventListener('keydown', handleShortcut)
  }, [canRedo, canSave, canUndo, commitPendingEdits, isClosePromptOpen, isSaving, onRedo, onSave, onUndo])

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

  function handleDoubleClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (activeTool !== 'select') return
    const objectId = findObjectAtClientPoint(event.currentTarget, document.objects, {
      x: event.clientX,
      y: event.clientY,
    })
    const object = document.objects.find((candidate) => candidate.id === objectId)
    if (object?.type !== 'text') return

    event.preventDefault()
    event.stopPropagation()
    const gesture = gestureRef.current
    gestureRef.current = null
    if (gesture && event.currentTarget.hasPointerCapture(gesture.pointerId)) {
      event.currentTarget.releasePointerCapture(gesture.pointerId)
    }
    setPreview(null)
    setMovePreview(null)
    setIsMovingObject(false)
    setSelectedObjectId(object.id)
    setActiveTextDraft({
      mode: 'edit',
      objectId: object.id,
      originalText: object.text,
      text: object.text,
      fontFamily: object.fontFamily,
      fontSize: object.fontSize,
      x: object.x,
      y: object.y,
    })
  }

  function handleCanvasClick(event: ReactMouseEvent<SVGSVGElement>) {
    if (activeTool !== 'text' || textDraftRef.current) return
    const position = pointerToArtboard(event.currentTarget, { x: event.clientX, y: event.clientY })
    if (!position) return
    setSelectedObjectId(null)
    setHoveredObjectId(null)
    setIsMovingObject(false)
    setActiveTextDraft({ mode: 'create', ...position, text: '' })
  }

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
        canExportPng={canExportPng}
        isExporting={isExporting}
        canUndo={canUndo}
        canRedo={canRedo}
        onSave={() => handleSave('save')}
        onSaveAs={handleSaveAs}
        onExportPng={handleExportPng}
        onUndo={onUndo}
        onRedo={onRedo}
        onMockAction={(action) => setMockActionMessage(`${action} — mock action`)}
      />
      <div className="editor-toolbar" aria-label="Editor status">
        <div className="editor-project-mark" aria-hidden="true">P</div>
        <strong className="editor-project-name">{session.projectName}</strong>
        <span className="editor-project-status">{textDraft ? 'Typing text…' : session.isDirty ? 'Unsaved session' : 'Saved project'}</span>
        <span className="editor-toolbar-spacer" />
        <span className="editor-dimensions">{artboard.width} × {artboard.height} px</span>
      </div>
      <div className="editor-main">
        <ToolPanel activeTool={activeTool} onToolChange={setActiveTool} />
        <section className="editor-stage" aria-label="Artboard workspace">
          <div className="editor-canvas-wrap" ref={canvasRef}>
            <div
              className={`editor-artboard${activeTool === 'rectangle' ? ' editor-artboard--drawing' : ''}${activeTool === 'text' ? ' editor-artboard--texting' : ''}${activeTool === 'select' && hoveredObjectId ? ' editor-artboard--move-target' : ''}${isMovingObject ? ' editor-artboard--moving' : ''}`}
              aria-label={`Artboard ${artboard.width} by ${artboard.height} pixels`}
              style={{ width: boardWidth, height: boardHeight }}
            >
              <svg
                ref={svgRef}
                className={`scene-svg${activeTool === 'rectangle' ? ' scene-svg--drawing' : ''}${activeTool === 'text' ? ' scene-svg--texting' : ''}${activeTool === 'select' && hoveredObjectId ? ' scene-svg--move-target' : ''}${isMovingObject ? ' scene-svg--moving' : ''}`}
                viewBox={`0 0 ${artboard.width} ${artboard.height}`}
                role="img"
                aria-label="Scene contents"
                onPointerDown={handlePointerDown}
                onClick={handleCanvasClick}
                onDoubleClick={handleDoubleClick}
                onLostPointerCapture={handleLostPointerCapture}
              >
                <SceneSvgContent document={document} positionPreview={movePreview} />
                {selectedObject && visibleSelectedBounds && (
                  <>
                    <rect
                      x={visibleSelectedBounds.x}
                      y={visibleSelectedBounds.y}
                      width={visibleSelectedBounds.width}
                      height={visibleSelectedBounds.height}
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth={4}
                      strokeDasharray="1 3"
                      vectorEffect="non-scaling-stroke"
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                    <rect
                      x={visibleSelectedBounds.x}
                      y={visibleSelectedBounds.y}
                      width={visibleSelectedBounds.width}
                      height={visibleSelectedBounds.height}
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
              {textDraft && (
                <textarea
                  ref={textareaRef}
                  className="text-draft-input"
                  autoFocus
                  aria-label="Type text. Press Control or Command plus Enter to finish."
                  value={textDraft.text}
                  placeholder="Type text…  Ctrl+Enter to finish"
                  maxLength={MAX_TEXT_LENGTH}
                  spellCheck={false}
                  style={{
                    left: textDraft.x * scale,
                    top: textDraft.y * scale,
                    width: Math.max(180, Math.max(1, ...textDraft.text.split('\n').map((line) => line.length)) * (textDraft.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * 0.6 * scale + 4),
                    height: Math.max(28, Math.max(1, textDraft.text.split('\n').length) * (textDraft.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * 1.2 * scale + 4),
                    fontSize: (textDraft.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale,
                    fontFamily: textDraft.fontFamily ?? 'Courier New, monospace',
                  }}
                  onChange={(event) => {
                    const draft = textDraftRef.current
                    if (draft) setActiveTextDraft({ ...draft, text: event.currentTarget.value })
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation()
                    if (event.nativeEvent.isComposing) return
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelTextDraft()
                    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault()
                      commitTextDraft()
                    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                      event.preventDefault()
                      if (canSave && !isSaving) handleSave()
                    }
                  }}
                  onBlur={commitTextDraft}
                />
              )}
            </div>
          </div>
          <div className="editor-stage__footer"><span>{zoomLabel}</span><span>{document.objects.length} objects</span></div>
        </section>
        <PropertyInspector
          ref={inspectorRef}
          document={document}
          selectedObject={selectedObject}
          onRectangleChange={updateRectangleProperties}
          onTextChange={updateTextProperties}
        />
      </div>
      <footer className="editor-statusbar">
        <span>{session.projectRoot ? 'Project opened from folder' : session.isDirty ? 'Project folder not set' : 'Opened in browser'}</span>
        <span className="editor-status-message" role="status" aria-live="polite" aria-atomic="true">{statusMessage || mockActionMessage || (isSaving ? 'Saving…' : '')}</span>
        <span>paintSMYS</span>
      </footer>
    </main>
  )
})

export default EditorWorkspace
