export const SCENE_SCHEMA_VERSION = 1
export const MAX_ARTBOARD_DIMENSION = 16_384
export const MAX_ARTBOARD_PIXELS = 100_000_000
export const DEFAULT_TEXT_FONT_FAMILY = 'Courier New'
export const DEFAULT_TEXT_FONT_SIZE = 20
export const DEFAULT_TEXT_COLOR = '#000000'
export const MAX_TEXT_FONT_SIZE = 1_024
export const MAX_TEXT_LENGTH = 100_000

export type Artboard = {
  width: number
  height: number
  backgroundColor: string
}

export type RectangleObject = {
  id: string
  type: 'rectangle'
  x: number
  y: number
  width: number
  height: number
  fill: string
  stroke: string
  strokeWidth: number
}

export type TextObject = {
  id: string
  type: 'text'
  /** Top-left of the text line box in Artboard coordinates. */
  x: number
  y: number
  text: string
  fontFamily: string
  fontSize: number
  color: string
  runs?: TextStyleRun[]
}

/** UTF-16 offsets into TextObject.text; start is inclusive and end is exclusive. */
export type TextStyleRun = {
  start: number
  end: number
  color: string
}

export type SceneObject = RectangleObject | TextObject

export type SceneDocument = {
  schemaVersion: typeof SCENE_SCHEMA_VERSION
  id: string
  artboard: Artboard
  objects: SceneObject[]
}

export type RectangleGeometry = Pick<RectangleObject, 'x' | 'y' | 'width' | 'height'>
export type ObjectPosition = Pick<RectangleObject, 'x' | 'y'>
export type TextObjectContent = Pick<TextObject, 'text'> & Partial<Pick<TextObject, 'fontFamily' | 'fontSize' | 'color' | 'runs'>>

export class DocumentValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^(#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})|transparent)$/i.test(value)
}

function isSurrogatePairBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return true
  const previous = text.charCodeAt(offset - 1)
  const next = text.charCodeAt(offset)
  return !(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff)
}

function validateTextRuns(text: string, value: unknown, objectIndex: number): TextStyleRun[] {
  if (!Array.isArray(value)) throw new DocumentValidationError(`Object ${objectIndex + 1} has invalid text style runs.`)

  let previousStart = -1
  let previousEnd = 0
  return value.map((item, runIndex): TextStyleRun => {
    if (!isRecord(item)) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style run ${runIndex + 1} is invalid.`)
    }
    const { start, end, color } = item
    if (!Number.isInteger(start) || !Number.isInteger(end) || (start as number) < 0 || (end as number) > text.length || (start as number) >= (end as number)) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style run ${runIndex + 1} has invalid UTF-16 offsets.`)
    }
    if ((start as number) < previousStart) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style runs must be sorted by start.`)
    }
    if ((start as number) < previousEnd) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style runs must not overlap.`)
    }
    if (!isSurrogatePairBoundary(text, start as number) || !isSurrogatePairBoundary(text, end as number)) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style run ${runIndex + 1} splits a UTF-16 surrogate pair.`)
    }
    if (!isColor(color)) {
      throw new DocumentValidationError(`Object ${objectIndex + 1} text style run ${runIndex + 1} has an invalid color.`)
    }

    previousStart = start as number
    previousEnd = end as number
    return { start: start as number, end: end as number, color }
  })
}

function textRunsEqual(left: TextStyleRun[] | undefined, right: TextStyleRun[] | undefined): boolean {
  if (!left?.length && !right?.length) return true
  if (left === undefined || right === undefined) return left === right
  return left.length === right.length && left.every((run, index) => {
    const other = right[index]
    return run.start === other.start && run.end === other.end && run.color === other.color
  })
}

export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `paint-smys-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function validateDimensions(width: unknown, height: unknown): asserts width is number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || (width as number) <= 0 || (height as number) <= 0) {
    throw new DocumentValidationError('Width and height must be positive whole numbers.')
  }

  if ((width as number) > MAX_ARTBOARD_DIMENSION || (height as number) > MAX_ARTBOARD_DIMENSION) {
    throw new DocumentValidationError(`Each dimension must be ${MAX_ARTBOARD_DIMENSION.toLocaleString()} px or less.`)
  }

  if ((width as number) * (height as number) > MAX_ARTBOARD_PIXELS) {
    throw new DocumentValidationError(`The Artboard cannot exceed ${MAX_ARTBOARD_PIXELS.toLocaleString()} pixels in total.`)
  }
}

export function createSceneDocument(width: number, height: number): SceneDocument {
  validateDimensions(width, height)

  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: createId(),
    artboard: { width, height, backgroundColor: '#ffffff' },
    objects: [],
  }
}

export function addRectangle(document: SceneDocument, geometry: RectangleGeometry): SceneDocument {
  const existingIds = new Set(document.objects.map((object) => object.id))
  let id = createId()
  while (existingIds.has(id)) id = createId()

  return validateSceneDocument({
    ...document,
    objects: [
      ...document.objects,
      {
        id,
        type: 'rectangle',
        ...geometry,
        fill: '#ffffff',
        stroke: '#000000',
        strokeWidth: 1,
      },
    ],
  })
}

export function addTextObject(
  document: SceneDocument,
  position: ObjectPosition & TextObjectContent,
): SceneDocument {
  const existingIds = new Set(document.objects.map((object) => object.id))
  let id = createId()
  while (existingIds.has(id)) id = createId()

  return validateSceneDocument({
    ...document,
    objects: [
      ...document.objects,
      {
        id,
        type: 'text',
        x: position.x,
        y: position.y,
        text: position.text,
        fontFamily: position.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY,
        fontSize: position.fontSize ?? DEFAULT_TEXT_FONT_SIZE,
        color: position.color ?? DEFAULT_TEXT_COLOR,
        ...(position.runs === undefined ? {} : { runs: position.runs }),
      },
    ],
  })
}

export function removeObject(document: SceneDocument, objectId: string): SceneDocument {
  if (!document.objects.some((object) => object.id === objectId)) {
    throw new DocumentValidationError(`Object "${objectId}" does not exist.`)
  }

  return validateSceneDocument({
    ...document,
    objects: document.objects.filter((object) => object.id !== objectId),
  })
}

export function updateTextObject(document: SceneDocument, objectId: string, text: string): SceneDocument {
  const objectIndex = document.objects.findIndex((object) => object.id === objectId)
  if (objectIndex === -1) {
    throw new DocumentValidationError(`Object "${objectId}" does not exist.`)
  }
  const object = document.objects[objectIndex]
  if (object.type !== 'text') {
    throw new DocumentValidationError(`Object "${objectId}" is not a text object.`)
  }
  if (object.text === text) {
    validateSceneDocument(document)
    return document
  }

  const objects = document.objects.slice()
  const updatedObject = { ...object, text }
  delete updatedObject.runs
  objects[objectIndex] = updatedObject
  return validateSceneDocument({ ...document, objects })
}

/** Replace or clear the character colors on one TextObject. */
export function setTextRuns(
  document: SceneDocument,
  objectId: string,
  runs: TextStyleRun[] | undefined,
): SceneDocument {
  const objectIndex = document.objects.findIndex((object) => object.id === objectId)
  if (objectIndex === -1) {
    throw new DocumentValidationError(`Object "${objectId}" does not exist.`)
  }

  const object = document.objects[objectIndex]
  if (object.type !== 'text') {
    throw new DocumentValidationError(`Object "${objectId}" is not a text object.`)
  }

  const updatedObject: TextObject = { ...object }
  if (runs === undefined) delete updatedObject.runs
  else updatedObject.runs = runs

  const objects = document.objects.slice()
  objects[objectIndex] = updatedObject
  const validated = validateSceneDocument({ ...document, objects })
  const validatedObject = validated.objects[objectIndex]
  if (validatedObject.type !== 'text') throw new DocumentValidationError(`Object "${objectId}" is not a text object.`)
  if (textRunsEqual(object.runs, validatedObject.runs)) return document
  return validated
}

export function moveObject(document: SceneDocument, objectId: string, nextPosition: ObjectPosition): SceneDocument {
  const objectIndex = document.objects.findIndex((object) => object.id === objectId)
  if (objectIndex === -1) {
    throw new DocumentValidationError(`Object "${objectId}" does not exist.`)
  }

  const object = document.objects[objectIndex]
  if (object.x === nextPosition.x && object.y === nextPosition.y) {
    validateSceneDocument(document)
    return document
  }

  const objects = document.objects.slice()
  objects[objectIndex] = { ...object, x: nextPosition.x, y: nextPosition.y }
  return validateSceneDocument({ ...document, objects })
}

export function validateSceneDocument(value: unknown): SceneDocument {
  if (!isRecord(value)) throw new DocumentValidationError('The scene must be an object.')
  if (value.schemaVersion !== SCENE_SCHEMA_VERSION) {
    throw new DocumentValidationError(`Scene schema version ${String(value.schemaVersion)} is not supported.`)
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new DocumentValidationError('The scene is missing its ID.')
  }
  if (!isRecord(value.artboard)) throw new DocumentValidationError('The scene is missing its Artboard.')
  validateDimensions(value.artboard.width, value.artboard.height)
  if (!isColor(value.artboard.backgroundColor)) {
    throw new DocumentValidationError('The Artboard background color is invalid.')
  }
  if (!Array.isArray(value.objects)) throw new DocumentValidationError('The scene objects must be a list.')

  const ids = new Set<string>()
  const objects = value.objects.map((item, index): SceneObject => {
    if (!isRecord(item) || (item.type !== 'rectangle' && item.type !== 'text')) {
      throw new DocumentValidationError(`Object ${index + 1} has an unsupported type.`)
    }
    if (typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id)) {
      throw new DocumentValidationError(`Object ${index + 1} has a missing or duplicate ID.`)
    }
    ids.add(item.id)
    if (![item.x, item.y].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
      throw new DocumentValidationError(`Object ${index + 1} has invalid coordinates.`)
    }

    if (item.type === 'text') {
      if (typeof item.text !== 'string' || item.text.length > MAX_TEXT_LENGTH || item.text.includes('\0')) {
        throw new DocumentValidationError(`Object ${index + 1} has invalid text.`)
      }
      if (typeof item.fontFamily !== 'string' || !item.fontFamily.trim() || item.fontFamily.length > 128) {
        throw new DocumentValidationError(`Object ${index + 1} has an invalid font family.`)
      }
      if (typeof item.fontSize !== 'number' || !Number.isFinite(item.fontSize) || item.fontSize < 1 || item.fontSize > MAX_TEXT_FONT_SIZE) {
        throw new DocumentValidationError(`Object ${index + 1} has an invalid font size.`)
      }
      if (!isColor(item.color)) {
        throw new DocumentValidationError(`Object ${index + 1} has an invalid color.`)
      }

      const textObject: TextObject = {
        id: item.id,
        type: 'text',
        x: item.x as number,
        y: item.y as number,
        text: item.text,
        fontFamily: item.fontFamily,
        fontSize: item.fontSize,
        color: item.color,
      }
      if (item.runs !== undefined) textObject.runs = validateTextRuns(item.text, item.runs, index)
      return textObject
    }

    if (![item.width, item.height].every((dimension) => typeof dimension === 'number' && Number.isFinite(dimension) && dimension > 0)) {
      throw new DocumentValidationError(`Object ${index + 1} has invalid dimensions.`)
    }
    if (!isColor(item.fill) || !isColor(item.stroke)) {
      throw new DocumentValidationError(`Object ${index + 1} has an invalid color.`)
    }
    if (typeof item.strokeWidth !== 'number' || !Number.isFinite(item.strokeWidth) || item.strokeWidth < 0) {
      throw new DocumentValidationError(`Object ${index + 1} has an invalid stroke width.`)
    }

    return {
      id: item.id,
      type: 'rectangle',
      x: item.x as number,
      y: item.y as number,
      width: item.width as number,
      height: item.height as number,
      fill: item.fill,
      stroke: item.stroke,
      strokeWidth: item.strokeWidth,
    }
  })

  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    id: value.id,
    artboard: {
      width: value.artboard.width as number,
      height: value.artboard.height as number,
      backgroundColor: value.artboard.backgroundColor,
    },
    objects,
  }
}
