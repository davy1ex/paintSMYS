import type { SceneObject, TextObject } from '../../core/document/scene-document'

export type Point = { x: number; y: number }

export type AffineTransform = {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

export type NormalizedRectangle = {
  x: number
  y: number
  width: number
  height: number
}

export function transformPoint(point: Point, matrix: AffineTransform): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export function transformVector(vector: Point, matrix: AffineTransform): Point {
  return {
    x: matrix.a * vector.x + matrix.c * vector.y,
    y: matrix.b * vector.x + matrix.d * vector.y,
  }
}

export function translateRectangle<T extends Pick<SceneObject, 'x' | 'y'>>(rectangle: T, delta: Point): T {
  return { ...rectangle, x: rectangle.x + delta.x, y: rectangle.y + delta.y }
}

export function getTextObjectBounds(object: Pick<TextObject, 'x' | 'y' | 'text' | 'fontSize'>): NormalizedRectangle {
  const lines = object.text.split('\n')
  const longestLine = Math.max(0, ...lines.map((line) => line.length))
  return {
    x: object.x,
    y: object.y,
    width: Math.max(1, longestLine) * object.fontSize * 0.6,
    height: lines.length * object.fontSize * 1.2,
  }
}

export function getSceneObjectBounds(object: SceneObject): NormalizedRectangle {
  if (object.type === 'text') return getTextObjectBounds(object)
  return { x: object.x, y: object.y, width: object.width, height: object.height }
}

export function normalizeRectangle(start: Point, end: Point): NormalizedRectangle {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function isGestureLongEnough(start: Point, end: Point, minimumCssPixels = 2): boolean {
  if (![start.x, start.y, end.x, end.y, minimumCssPixels].every(Number.isFinite)) return false
  return Math.hypot(end.x - start.x, end.y - start.y) >= minimumCssPixels
}

export function findTopmostObjectAtPoint(
  objects: SceneObject[],
  point: Point,
  tolerance: Point = { x: 0, y: 0 },
): string | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]
    const bounds = getSceneObjectBounds(object)
    if (
      point.x >= bounds.x - tolerance.x && point.x <= bounds.x + bounds.width + tolerance.x &&
      point.y >= bounds.y - tolerance.y && point.y <= bounds.y + bounds.height + tolerance.y
    ) return object.id
  }

  return null
}

/** @deprecated Use findTopmostObjectAtPoint; kept for existing geometry callers. */
export const findTopmostRectangleAtPoint = findTopmostObjectAtPoint
