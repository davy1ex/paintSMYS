import assert from 'node:assert/strict'
import { test } from 'node:test'
import { clampZoomScale, controlZoomScale, fitScaleForViewport, panForZoomAnchor, panFromPointerDrag, wheelZoomScale } from '../src/editor/workspace/viewport-math'

test('zoom anchor stays at the same screen point with fractional positions and existing pan', () => {
  const board = { width: 600, height: 400 }
  const center = { x: 412.25, y: 280.75 }
  const pan = { x: 83.5, y: -27.25 }
  const anchor = { x: 217.375, y: 194.625 }
  const nextPan = panForZoomAnchor(1.25, 2.5, pan, anchor, center, board)

  const oldLeft = center.x + pan.x - board.width * 1.25 / 2
  const oldTop = center.y + pan.y - board.height * 1.25 / 2
  const scenePoint = { x: (anchor.x - oldLeft) / 1.25, y: (anchor.y - oldTop) / 1.25 }
  const nextLeft = center.x + nextPan.x - board.width * 2.5 / 2
  const nextTop = center.y + nextPan.y - board.height * 2.5 / 2
  assert.ok(Math.abs(nextLeft + scenePoint.x * 2.5 - anchor.x) < 1e-10)
  assert.ok(Math.abs(nextTop + scenePoint.y * 2.5 - anchor.y) < 1e-10)
})

test('pointer drag pans one-to-one from a stable drag origin', () => {
  assert.deepEqual(
    panFromPointerDrag({ x: 20.25, y: -10.5 }, { x: 100.5, y: 40.25 }, { x: 160.5, y: 80.25 }),
    { x: 80.25, y: 29.5 },
  )
})

test('Fit uses the smaller available dimension and does not upscale past one-to-one', () => {
  assert.equal(fitScaleForViewport({ width: 900, height: 500 }, { width: 1200, height: 600 }), 0.75)
  assert.equal(fitScaleForViewport({ width: 1200, height: 800 }, { width: 600, height: 400 }), 1)
  assert.equal(fitScaleForViewport({ width: 0, height: 800 }, { width: 600, height: 400 }), 0)
})

test('manual zoom clamps at 10% and 800%', () => {
  assert.equal(clampZoomScale(0.01), 0.1)
  assert.equal(clampZoomScale(9), 8)
  assert.equal(controlZoomScale(7.9, 1), 8)
  assert.equal(controlZoomScale(0.2, -1), 0.1)
})

test('wheel zoom normalizes pixel, line and page deltas', () => {
  assert.equal(wheelZoomScale(1, -120, 0, 800), 1.2)
  assert.equal(wheelZoomScale(1, -7.5, 1, 800), 1.2)
  assert.equal(wheelZoomScale(1, -0.15, 2, 800), 1.2)
})
