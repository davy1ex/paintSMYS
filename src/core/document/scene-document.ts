export const SCENE_SCHEMA_VERSION = 1
export const MAX_ARTBOARD_DIMENSION = 16_384
export const MAX_ARTBOARD_PIXELS = 100_000_000

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

export type SceneObject = RectangleObject

export type SceneDocument = {
  schemaVersion: typeof SCENE_SCHEMA_VERSION
  id: string
  artboard: Artboard
  objects: SceneObject[]
}

export type RectangleGeometry = Pick<RectangleObject, 'x' | 'y' | 'width' | 'height'>

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

export function removeObject(document: SceneDocument, objectId: string): SceneDocument {
  if (!document.objects.some((object) => object.id === objectId)) {
    throw new DocumentValidationError(`Object "${objectId}" does not exist.`)
  }

  return validateSceneDocument({
    ...document,
    objects: document.objects.filter((object) => object.id !== objectId),
  })
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
  const objects = value.objects.map((item, index): RectangleObject => {
    if (!isRecord(item) || item.type !== 'rectangle') {
      throw new DocumentValidationError(`Object ${index + 1} has an unsupported type.`)
    }
    if (typeof item.id !== 'string' || item.id.length === 0 || ids.has(item.id)) {
      throw new DocumentValidationError(`Object ${index + 1} has a missing or duplicate ID.`)
    }
    ids.add(item.id)
    if (![item.x, item.y].every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))) {
      throw new DocumentValidationError(`Object ${index + 1} has invalid coordinates.`)
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
