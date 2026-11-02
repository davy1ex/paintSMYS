import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type {
  RectangleObject,
  RectangleObjectProperties,
  SceneDocument,
  SceneObject,
  TextObject,
  TextObjectProperties,
} from '../../core/document/scene-document'

export type PropertyInspectorHandle = {
  commitPendingEdits: () => boolean
}

type PropertyInspectorProps = {
  document: SceneDocument
  selectedObject: SceneObject | null
  onRectangleChange: (objectId: string, properties: RectangleObjectProperties) => string | null
  onTextChange: (objectId: string, properties: TextObjectProperties) => string | null
}

type InspectorFieldProps<T> = {
  label: string
  value: T
  fieldKey: string
  inputMode?: 'decimal' | 'text'
  swatch?: string
  parse: (raw: string) => { value: T } | { error: string }
  format?: (value: T) => string
  onCommit: (value: T) => string | null
  registerCommitter: (fieldKey: string, commit: () => boolean) => () => void
}

function numericValue(raw: string): { value: number } | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: 'Enter a number.' }
  const value = Number(trimmed)
  return Number.isFinite(value) ? { value } : { error: 'Enter a finite number.' }
}

function InspectorField<T>({
  label,
  value,
  fieldKey,
  inputMode,
  swatch,
  parse,
  format = String,
  onCommit,
  registerCommitter,
}: InspectorFieldProps<T>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef(format(value))
  const dirtyRef = useRef(false)
  const commitRef = useRef<() => boolean>(() => true)
  const [draft, setDraft] = useState(format(value))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (dirtyRef.current) return
    const formatted = format(value)
    draftRef.current = formatted
    setDraft(formatted)
  }, [format, value])

  commitRef.current = () => {
    if (!dirtyRef.current) return true
    const parsed = parse(draftRef.current)
    if ('error' in parsed) {
      setError(parsed.error)
      return false
    }

    const message = onCommit(parsed.value)
    if (message) {
      setError(message)
      return false
    }

    const formatted = format(parsed.value)
    dirtyRef.current = false
    draftRef.current = formatted
    setDraft(formatted)
    setError(null)
    return true
  }

  useEffect(
    () => registerCommitter(fieldKey, () => {
      const committed = commitRef.current()
      if (!committed) inputRef.current?.focus()
      return committed
    }),
    [fieldKey, registerCommitter],
  )

  const cancelDraft = () => {
    const formatted = format(value)
    dirtyRef.current = false
    draftRef.current = formatted
    setDraft(formatted)
    setError(null)
  }

  return (
    <label className="inspector-field">
      <span className="inspector-field__label">{label}</span>
      <div className="inspector-field__control">
        {swatch !== undefined && <span className="inspector-color-swatch" style={{ backgroundColor: swatch }} aria-hidden="true" />}
        <input
          ref={inputRef}
          className="inspector-input"
          type="text"
          inputMode={inputMode}
          value={draft}
          aria-label={label}
          aria-invalid={error ? 'true' : undefined}
          title={error ?? undefined}
          onChange={(event) => {
            draftRef.current = event.currentTarget.value
            dirtyRef.current = true
            setDraft(event.currentTarget.value)
            setError(null)
          }}
          onBlur={() => { commitRef.current() }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              if (commitRef.current()) inputRef.current?.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancelDraft()
              inputRef.current?.blur()
            }
          }}
        />
      </div>
      {error && <span className="inspector-field__error" role="alert">{error}</span>}
    </label>
  )
}

const PropertyInspector = forwardRef<PropertyInspectorHandle, PropertyInspectorProps>(function PropertyInspector({
  document,
  selectedObject,
  onRectangleChange,
  onTextChange,
}, ref) {
  const committersRef = useRef(new Map<string, () => boolean>())
  const registerCommitter = useCallback((fieldKey: string, commit: () => boolean) => {
    committersRef.current.set(fieldKey, commit)
    return () => {
      if (committersRef.current.get(fieldKey) === commit) committersRef.current.delete(fieldKey)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    commitPendingEdits: () => {
      for (const commit of committersRef.current.values()) {
        if (!commit()) return false
      }
      return true
    },
  }), [])

  const field = <T,>(
    objectId: string,
    property: string,
    label: string,
    value: T,
    parse: InspectorFieldProps<T>['parse'],
    onCommit: (value: T) => string | null,
    inputMode: InspectorFieldProps<T>['inputMode'] = 'text',
    swatch?: string,
  ) => (
    <InspectorField
      key={`${objectId}:${property}`}
      fieldKey={`${objectId}:${property}`}
      label={label}
      value={value}
      swatch={swatch}
      parse={parse}
      onCommit={onCommit}
      inputMode={inputMode}
      registerCommitter={registerCommitter}
    />
  )

  const updateRectangle = (object: RectangleObject, patch: RectangleObjectProperties) =>
    onRectangleChange(object.id, patch)
  const updateText = (object: TextObject, patch: TextObjectProperties) =>
    onTextChange(object.id, patch)

  return (
    <aside className="property-inspector" aria-label="Property Inspector">
      <div className="inspector-title">
        {selectedObject?.type === 'rectangle'
          ? 'Rectangle Properties'
          : selectedObject?.type === 'text'
            ? 'Text Properties'
            : 'Scene Properties'}
      </div>
      {selectedObject?.type === 'rectangle' ? (
        <div className="inspector-object" key={selectedObject.id}>
          <div className="inspector-section-label">RECTANGLE</div>
          <div className="inspector-fields">
            {field(selectedObject.id, 'x', 'X', selectedObject.x, numericValue, (value) => updateRectangle(selectedObject, { x: value }), 'decimal')}
            {field(selectedObject.id, 'y', 'Y', selectedObject.y, numericValue, (value) => updateRectangle(selectedObject, { y: value }), 'decimal')}
            {field(selectedObject.id, 'width', 'Width', selectedObject.width, numericValue, (value) => updateRectangle(selectedObject, { width: value }), 'decimal')}
            {field(selectedObject.id, 'height', 'Height', selectedObject.height, numericValue, (value) => updateRectangle(selectedObject, { height: value }), 'decimal')}
            {field(selectedObject.id, 'fill', 'Fill Color', selectedObject.fill, (raw) => ({ value: raw.trim() }), (value) => updateRectangle(selectedObject, { fill: value }), 'text', selectedObject.fill)}
            {field(selectedObject.id, 'stroke', 'Stroke Color', selectedObject.stroke, (raw) => ({ value: raw.trim() }), (value) => updateRectangle(selectedObject, { stroke: value }), 'text', selectedObject.stroke)}
            {field(selectedObject.id, 'strokeWidth', 'Stroke Width', selectedObject.strokeWidth, numericValue, (value) => updateRectangle(selectedObject, { strokeWidth: value }), 'decimal')}
          </div>
        </div>
      ) : selectedObject?.type === 'text' ? (
        <div className="inspector-object" key={selectedObject.id}>
          <div className="inspector-section-label">TEXT</div>
          <div className="inspector-fields">
            {field(selectedObject.id, 'x', 'X', selectedObject.x, numericValue, (value) => updateText(selectedObject, { x: value }), 'decimal')}
            {field(selectedObject.id, 'y', 'Y', selectedObject.y, numericValue, (value) => updateText(selectedObject, { y: value }), 'decimal')}
            {field(selectedObject.id, 'fontFamily', 'Font Family', selectedObject.fontFamily, (raw) => ({ value: raw }), (value) => updateText(selectedObject, { fontFamily: value }))}
            {field(selectedObject.id, 'fontSize', 'Font Size', selectedObject.fontSize, numericValue, (value) => updateText(selectedObject, { fontSize: value }), 'decimal')}
            {field(selectedObject.id, 'color', 'Base Color', selectedObject.color, (raw) => ({ value: raw.trim() }), (value) => updateText(selectedObject, { color: value }), 'text', selectedObject.color)}
          </div>
          {selectedObject.runs && selectedObject.runs.length > 0 && (
            <div className="inspector-runs" aria-label="Styled Text ranges">
              <div className="inspector-section-label">STYLED RANGES · {selectedObject.runs.length}</div>
              {selectedObject.runs.map((run, index) => (
                <div className="inspector-run" key={`${run.start}:${run.end}:${index}`}>
                  <span className="color-chip" style={{ backgroundColor: run.color }} aria-hidden="true" />
                  <span>{run.color}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="inspector-section-label">ARTBOARD</div>
          <dl className="inspector-list">
            <div><dt>Width</dt><dd>{document.artboard.width} px</dd></div>
            <div><dt>Height</dt><dd>{document.artboard.height} px</dd></div>
            <div><dt>Background</dt><dd><span className="color-chip" style={{ backgroundColor: document.artboard.backgroundColor }} />{document.artboard.backgroundColor}</dd></div>
          </dl>
          <div className="inspector-divider" />
          <div className="inspector-section-label">SCENE</div>
          <dl className="inspector-list">
            <div><dt>Objects</dt><dd>{document.objects.length}</dd></div>
            <div><dt>Scene ID</dt><dd className="inspector-id" title={document.id}>{document.id.slice(0, 8)}…</dd></div>
          </dl>
          <div className="inspector-empty">Select an object to inspect its properties.</div>
        </>
      )}
    </aside>
  )
})

export default PropertyInspector
