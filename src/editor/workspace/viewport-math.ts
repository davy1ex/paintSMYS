import type { Point } from './rectangle-geometry'

export const MIN_ZOOM_SCALE = 0.1
export const MAX_ZOOM_SCALE = 8
export const PAN_POINTER_SENSITIVITY = 1

export type ArtboardSize = { width: number; height: number }

export function clampZoomScale(scale: number): number {
  return Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, scale))
}

export function fitScaleForViewport(viewport: ArtboardSize, artboard: ArtboardSize): number {
  if (viewport.width <= 0 || viewport.height <= 0 || artboard.width <= 0 || artboard.height <= 0) return 0
  return Math.min(1, viewport.width / artboard.width, viewport.height / artboard.height)
}

export function panFromPointerDrag(startPan: Point, startPointer: Point, currentPointer: Point): Point {
  return {
    x: startPan.x + (currentPointer.x - startPointer.x) * PAN_POINTER_SENSITIVITY,
    y: startPan.y + (currentPointer.y - startPointer.y) * PAN_POINTER_SENSITIVITY,
  }
}

/** Returns the pan that keeps one document point under the same screen point while zoom changes. */
export function panForZoomAnchor(
  currentScale: number,
  nextScale: number,
  pan: Point,
  screenPoint: Point,
  viewportCenter: Point,
  artboard: ArtboardSize,
): Point {
  const currentOrigin = {
    x: viewportCenter.x + pan.x - artboard.width * currentScale / 2,
    y: viewportCenter.y + pan.y - artboard.height * currentScale / 2,
  }
  const documentPoint = {
    x: (screenPoint.x - currentOrigin.x) / currentScale,
    y: (screenPoint.y - currentOrigin.y) / currentScale,
  }
  return {
    x: screenPoint.x - viewportCenter.x - (documentPoint.x - artboard.width / 2) * nextScale,
    y: screenPoint.y - viewportCenter.y - (documentPoint.y - artboard.height / 2) * nextScale,
  }
}

export function wheelZoomScale(
  scale: number,
  deltaY: number,
  deltaMode: number,
  viewportHeight: number,
): number {
  const deltaInPixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? viewportHeight : 1)
  return clampZoomScale(scale * Math.pow(1.2, -deltaInPixels / 120))
}

export function controlZoomScale(scale: number, direction: -1 | 1): number {
  return clampZoomScale(scale + direction * 0.25)
}
