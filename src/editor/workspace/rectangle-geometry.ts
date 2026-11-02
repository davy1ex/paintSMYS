import type { SceneObject } from '../../core/document/scene-document'

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

export function findTopmostRectangleAtPoint(
  objects: SceneObject[],
  point: Point,
  tolerance: Point = { x: 0, y: 0 },
): string | null {
  for (let index = objects.length - 1; index >= 0; index -= 1) {
    const object = objects[index]
    if (
      point.x >= object.x - tolerance.x && point.x <= object.x + object.width + tolerance.x &&
      point.y >= object.y - tolerance.y && point.y <= object.y + object.height + tolerance.y
    ) return object.id
  }

  return null
}
