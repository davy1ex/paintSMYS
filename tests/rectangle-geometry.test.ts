import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRectangle, createSceneDocument } from '../src/core/document/scene-document'
import { findTopmostRectangleAtPoint, isGestureLongEnough, normalizeRectangle, transformPoint, transformVector, translateRectangle, type Point } from '../src/editor/workspace/rectangle-geometry'

test('normalizeRectangle handles all four drag directions', () => {
  const drags: [Point, Point][] = [
    [{ x: 10, y: 20 }, { x: 30, y: 50 }],
    [{ x: 30, y: 20 }, { x: 10, y: 50 }],
    [{ x: 10, y: 50 }, { x: 30, y: 20 }],
    [{ x: 30, y: 50 }, { x: 10, y: 20 }],
  ]
  for (const [start, end] of drags) {
    assert.deepEqual(normalizeRectangle(start, end), { x: 10, y: 20, width: 20, height: 30 })
  }
})

test('gesture length ignores zero and under two CSS pixel drags', () => {
  assert.equal(isGestureLongEnough({ x: 2, y: 3 }, { x: 2, y: 3 }), false)
  assert.equal(isGestureLongEnough({ x: 0, y: 0 }, { x: 1.99, y: 0 }), false)
  assert.equal(isGestureLongEnough({ x: 0, y: 0 }, { x: 2, y: 0 }), true)
})

test('inverse SVG transforms map screen points at different view scales', () => {
  const zoomedIn = transformPoint(
    { x: 140, y: 90 },
    { a: 0.5, b: 0, c: 0, d: 0.5, e: -50, f: -25 },
  )
  assert.deepEqual(zoomedIn, { x: 20, y: 20 })

  const zoomedOut = transformPoint(
    { x: 20, y: 20 },
    { a: 2, b: 0, c: 0, d: 2, e: -20, f: -20 },
  )
  assert.deepEqual(zoomedOut, { x: 20, y: 20 })
})

test('client movement is converted to scene deltas at different SVG scales', () => {
  const atHalfScale = transformVector(
    { x: 24, y: -12 },
    { a: 2, b: 0, c: 0, d: 2, e: -200, f: 80 },
  )
  const atQuarterScale = transformVector(
    { x: 24, y: -12 },
    { a: 4, b: 0, c: 0, d: 4, e: 50, f: 120 },
  )

  assert.deepEqual(atHalfScale, { x: 48, y: -24 })
  assert.deepEqual(atQuarterScale, { x: 96, y: -48 })
})

test('rectangle translation preserves the cursor offset in every direction', () => {
  const rectangle = { x: 20, y: 30, width: 40, height: 25 }
  const startPointer = { x: 27, y: 34 }
  const pointerOffset = { x: startPointer.x - rectangle.x, y: startPointer.y - rectangle.y }
  const movements: Point[] = [
    { x: 12, y: 0 },
    { x: -12, y: 0 },
    { x: 0, y: 12 },
    { x: 0, y: -12 },
  ]

  for (const movement of movements) {
    const moved = translateRectangle(rectangle, movement)
    const endPointer = { x: startPointer.x + movement.x, y: startPointer.y + movement.y }
    assert.deepEqual(
      { x: endPointer.x - moved.x, y: endPointer.y - moved.y },
      pointerOffset,
    )
  }
})

test('rectangle hit testing returns the topmost overlapping object and ignores empty space', () => {
  const first = addRectangle(createSceneDocument(800, 600), { x: 10, y: 10, width: 40, height: 40 })
  const scene = addRectangle(first, { x: 20, y: 20, width: 40, height: 40 })

  assert.equal(findTopmostRectangleAtPoint(scene.objects, { x: 25, y: 25 }), scene.objects[1].id)
  assert.equal(findTopmostRectangleAtPoint(scene.objects, { x: 15, y: 15 }), scene.objects[0].id)
  assert.equal(findTopmostRectangleAtPoint(scene.objects, { x: 100, y: 100 }), null)
})

test('rectangle hit testing can include a small grab margin and still prefer the topmost object', () => {
  const underlying = addRectangle(createSceneDocument(800, 600), { x: 90, y: 90, width: 40, height: 40 })
  const scene = addRectangle(underlying, { x: 110, y: 100, width: 2, height: 30 })
  const pointBesideThinRectangle = { x: 106, y: 115 }

  assert.equal(findTopmostRectangleAtPoint(scene.objects, pointBesideThinRectangle), underlying.objects[0].id)
  assert.equal(findTopmostRectangleAtPoint(scene.objects, pointBesideThinRectangle, { x: 5, y: 5 }), scene.objects[1].id)
})

