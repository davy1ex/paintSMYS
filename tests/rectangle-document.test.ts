import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addRectangle, createSceneDocument, DocumentValidationError, removeObject } from '../src/core/document/scene-document'

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
