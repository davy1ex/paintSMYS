import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRectangle, addTextObject, createSceneDocument, DocumentValidationError, moveObject, removeObject, updateRectangleObjectProperties } from '../src/core/document/scene-document'

test('addRectangle returns a valid immutable scene and preserves object order', () => {
  const original = createSceneDocument(800, 600)
  const first = addRectangle(original, { x: 10, y: 20, width: 80, height: 40 })
  const second = addRectangle(first, { x: 2, y: 3, width: 4, height: 5 })

  assert.equal(original.objects.length, 0)
  assert.notEqual(first, original)
  assert.equal(first.objects.length, 1)
  assert.equal(second.objects.length, 2)
  assert.notEqual(first.objects[0].id, second.objects[1].id)
  assert.equal(second.objects[0].id, first.objects[0].id)
  assert.deepEqual(first.objects[0], {
    id: first.objects[0].id,
    type: 'rectangle',
    x: 10,
    y: 20,
    width: 80,
    height: 40,
    fill: '#ffffff',
    stroke: '#000000',
    strokeWidth: 1,
  })
})

test('addRectangle accepts palette appearance while keeping legacy defaults', () => {
  const scene = createSceneDocument(320, 240)
  const colored = addRectangle(scene, { x: 5, y: 6, width: 40, height: 30 }, {
    fill: '#00ff00',
    stroke: '#0000ff',
  })
  const rectangle = colored.objects[0]
  assert.equal(rectangle?.type, 'rectangle')
  if (rectangle?.type !== 'rectangle') throw new Error('Expected a rectangle.')
  assert.equal(rectangle.fill, '#00ff00')
  assert.equal(rectangle.stroke, '#0000ff')
  assert.equal(rectangle.strokeWidth, 1)
  assert.throws(() => addRectangle(scene, { x: 5, y: 6, width: 40, height: 30 }, { fill: 'not-a-color' }), DocumentValidationError)
})

test('addRectangle rejects invalid geometry through the scene validator', () => {
  const scene = createSceneDocument(800, 600)
  for (const geometry of [
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: -1, height: 10 },
    { x: Number.NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: 10, height: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(() => addRectangle(scene, geometry), DocumentValidationError)
  }
})

test('removeObject returns a valid immutable scene and preserves the remaining order', () => {
  const original = createSceneDocument(800, 600)
  const withFirst = addRectangle(original, { x: 10, y: 20, width: 80, height: 40 })
  const withSecond = addRectangle(withFirst, { x: 100, y: 120, width: 50, height: 30 })
  const withThird = addRectangle(withSecond, { x: 200, y: 220, width: 25, height: 15 })
  const [first, second, third] = withThird.objects

  const result = removeObject(withThird, second.id)

  assert.notEqual(result, withThird)
  assert.notEqual(result.objects, withThird.objects)
  assert.deepEqual(result.objects.map((object) => object.id), [first.id, third.id])
  assert.deepEqual(withThird.objects.map((object) => object.id), [first.id, second.id, third.id])
  assert.equal(result.id, withThird.id)
  assert.deepEqual(result.artboard, withThird.artboard)
})

test('removeObject reports an unknown ID without changing the source document', () => {
  const original = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const before = structuredClone(original)

  assert.throws(() => removeObject(original, 'missing-object'), DocumentValidationError)
  assert.deepEqual(original, before)
})

test('moveObject changes only the selected rectangle position and preserves order and source', () => {
  const original = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const withSecond = addRectangle(original, { x: 120, y: 140, width: 50, height: 30 })
  const before = structuredClone(withSecond)
  const [first, second] = withSecond.objects

  const moved = moveObject(withSecond, first.id, { x: -5, y: 75 })

  assert.notEqual(moved, withSecond)
  assert.deepEqual(withSecond, before)
  assert.deepEqual(moved.objects.map((object) => object.id), [first.id, second.id])
  assert.deepEqual(moved.objects[0], { ...first, x: -5, y: 75 })
  assert.deepEqual(moved.objects[1], second)
  assert.deepEqual(moved.artboard, withSecond.artboard)
})

test('moveObject reports unknown IDs and rejects invalid coordinates', () => {
  const original = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const before = structuredClone(original)

  assert.throws(() => moveObject(original, 'missing-object', { x: 0, y: 0 }), DocumentValidationError)
  assert.throws(() => moveObject(original, original.objects[0].id, { x: Number.NaN, y: 0 }), DocumentValidationError)
  assert.throws(() => moveObject(original, original.objects[0].id, { x: 0, y: Number.POSITIVE_INFINITY }), DocumentValidationError)
  assert.deepEqual(original, before)
})

test('moveObject returns the original document for a no-op', () => {
  const original = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const rectangle = original.objects[0]

  assert.equal(moveObject(original, rectangle.id, { x: rectangle.x, y: rectangle.y }), original)
})

test('Rectangle property edits are immutable, preserve other objects and validate final dimensions and colors', () => {
  const withRectangle = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const original = addRectangle(withRectangle, { x: 120, y: 140, width: 50, height: 30 })
  const before = structuredClone(original)
  const [rectangle, other] = original.objects

  const edited = updateRectangleObjectProperties(original, rectangle.id, {
    x: -5,
    y: 75,
    width: 500,
    height: 250,
    fill: '#abc',
    stroke: '#112233',
    strokeWidth: 3,
  })

  assert.deepEqual(original, before)
  assert.deepEqual(edited.objects.map((object) => object.id), [rectangle.id, other.id])
  assert.deepEqual(edited.objects[0], { ...rectangle, x: -5, y: 75, width: 500, height: 250, fill: '#abc', stroke: '#112233', strokeWidth: 3 })
  assert.deepEqual(edited.objects[1], other)
  assert.equal(updateRectangleObjectProperties(edited, rectangle.id, { width: 500 }), edited)
  assert.throws(() => updateRectangleObjectProperties(original, rectangle.id, { width: 0 }), DocumentValidationError)
  assert.throws(() => updateRectangleObjectProperties(original, rectangle.id, { height: -1 }), DocumentValidationError)
  assert.throws(() => updateRectangleObjectProperties(original, rectangle.id, { fill: 'url(javascript:alert(1))' }), DocumentValidationError)
  assert.throws(() => updateRectangleObjectProperties(original, rectangle.id, { stroke: 'invalid' }), DocumentValidationError)
  assert.throws(() => updateRectangleObjectProperties(original, rectangle.id, { strokeWidth: -1 }), DocumentValidationError)
  assert.throws(() => updateRectangleObjectProperties(original, 'missing', { x: 1 }), /does not exist/)
  const withText = addTextObject(original, { x: 1, y: 2, text: 'text' })
  assert.throws(() => updateRectangleObjectProperties(withText, withText.objects[2].id, { x: 1 }), /not a rectangle object/)
  assert.deepEqual(original, before)
})
