import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DocumentHistory } from '../src/application/document-history'
import { createUntitledProjectSession, openProjectSession, updateProjectSessionDocument } from '../src/application/project-session'
import { saveProjectSession } from '../src/application/save-project-session'
import {
  addRectangle,
  addTextObject,
  createSceneDocument,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_FAMILY,
  DEFAULT_TEXT_FONT_SIZE,
  DocumentValidationError,
  moveObject,
  removeObject,
  updateTextObject,
  validateSceneDocument,
} from '../src/core/document/scene-document'
import { createProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'
import { findTopmostObjectAtPoint, getTextObjectBounds, transformPoint } from '../src/editor/workspace/rectangle-geometry'

test('addTextObject creates an immutable multiline Unicode object with defaults and preserves rectangles', () => {
  const original = addRectangle(createSceneDocument(800, 600), { x: 10, y: 20, width: 80, height: 40 })
  const before = structuredClone(original)
  const text = 'Привет, world!\nlet  value = "✓"'
  const next = addTextObject(original, { x: 110, y: 120, text })
  const object = next.objects[1]

  assert.deepEqual(original, before)
  assert.deepEqual(next.objects[0], original.objects[0])
  assert.deepEqual(object, {
    id: object.id,
    type: 'text',
    x: 110,
    y: 120,
    text,
    fontFamily: DEFAULT_TEXT_FONT_FAMILY,
    fontSize: DEFAULT_TEXT_FONT_SIZE,
    color: DEFAULT_TEXT_COLOR,
  })
  assert.equal(next.objects[0].type, 'rectangle')
})

test('text object validation rejects invalid IDs, strings, coordinates, fonts, sizes, and colors', () => {
  const base = addTextObject(createSceneDocument(800, 600), { x: 0, y: 0, text: 'valid' })
  const valid = base.objects[0]
  const invalidObjects = [
    { ...valid, id: '' },
    { ...valid, id: 'duplicate', text: '\0' },
    { ...valid, text: 42 },
    { ...valid, text: 'x'.repeat(100_001) },
    { ...valid, x: Number.NaN },
    { ...valid, y: Number.POSITIVE_INFINITY },
    { ...valid, fontFamily: '   ' },
    { ...valid, fontSize: 0 },
    { ...valid, fontSize: 1_025 },
    { ...valid, fontSize: Number.NaN },
    { ...valid, color: 'url(javascript:alert(1))' },
  ]

  for (const object of invalidObjects) {
    assert.throws(() => validateSceneDocument({ ...base, objects: [object] }), DocumentValidationError)
  }
  assert.throws(() => validateSceneDocument({ ...base, objects: [valid, { ...valid }] }), /duplicate ID/)
})

test('updateTextObject is immutable, supports Unicode, and returns the same scene for a no-op', () => {
  const original = addTextObject(createSceneDocument(800, 600), { x: 8, y: 12, text: 'old' })
  const textObject = original.objects[0]
  const updated = updateTextObject(original, textObject.id, 'новая строка\n日本語 🎨')

  assert.equal(original.objects[0].type, 'text')
  assert.equal(updated.objects[0].type, 'text')
  if (updated.objects[0].type !== 'text') assert.fail('Expected a text object')
  assert.equal(updated.objects[0].text, 'новая строка\n日本語 🎨')
  assert.equal(updateTextObject(updated, textObject.id, updated.objects[0].text), updated)
  assert.throws(() => updateTextObject(updated, 'missing', 'x'), DocumentValidationError)
  const rectangleScene = addRectangle(createSceneDocument(800, 600), { x: 0, y: 0, width: 5, height: 5 })
  assert.throws(() => updateTextObject(rectangleScene, rectangleScene.objects[0].id, 'x'), /not a text object/)
})

test('moveObject and removeObject work with text while preserving document order and source snapshots', () => {
  const rectangleScene = addRectangle(createSceneDocument(800, 600), { x: 0, y: 0, width: 40, height: 30 })
  const scene = addTextObject(rectangleScene, { x: 50, y: 60, text: 'move me' })
  const textObject = scene.objects[1]
  const moved = moveObject(scene, textObject.id, { x: 75, y: 90 })

  assert.equal(scene.objects[1].x, 50)
  assert.deepEqual(moved.objects.map(({ id }) => id), scene.objects.map(({ id }) => id))
  assert.equal(moved.objects[1].x, 75)
  assert.equal(moved.objects[1].y, 90)
  assert.deepEqual(removeObject(moved, textObject.id).objects, [rectangleScene.objects[0]])
})

test('text geometry uses the same top-left anchor at every SVG scale and hit-tests the topmost object', () => {
  const scene = addRectangle(createSceneDocument(800, 600), { x: 100, y: 100, width: 120, height: 80 })
  const withText = addTextObject(scene, { x: 110, y: 110, text: 'abcd\nxy' })
  const textObject = withText.objects[1]
  if (textObject.type !== 'text') assert.fail('Expected a text object')
  const bounds = getTextObjectBounds(textObject)

  assert.deepEqual(bounds, { x: 110, y: 110, width: 48, height: 48 })
  const screenAtHalfScale = transformPoint({ x: 110, y: 110 }, { a: 0.5, b: 0, c: 0, d: 0.5, e: 10, f: 15 })
  const atHalfScale = transformPoint(screenAtHalfScale, { a: 2, b: 0, c: 0, d: 2, e: -20, f: -30 })
  const screenAtQuarterScale = transformPoint({ x: 110, y: 110 }, { a: 0.25, b: 0, c: 0, d: 0.25, e: 5, f: 7.5 })
  const atQuarterScale = transformPoint(screenAtQuarterScale, { a: 4, b: 0, c: 0, d: 4, e: -20, f: -30 })
  assert.deepEqual(atHalfScale, { x: 110, y: 110 })
  assert.deepEqual(atQuarterScale, { x: 110, y: 110 })
  assert.equal(findTopmostObjectAtPoint(withText.objects, { x: 115, y: 115 }), textObject.id)
  assert.equal(findTopmostObjectAtPoint(withText.objects, { x: 115, y: 115 }, { x: 0, y: 0 }), textObject.id)
  assert.equal(findTopmostObjectAtPoint(withText.objects, { x: 300, y: 300 }), null)
})

test('old rectangle-only project manifests remain readable with their original shape', () => {
  const rectangleOnly = addRectangle(createSceneDocument(640, 480), { x: 4, y: 5, width: 60, height: 30 })
  const manifest = createProjectManifest('legacy', 'Legacy Project', rectangleOnly)
  const opened = openProjectSession(serializeProjectManifest(manifest), null)

  assert.equal(opened.document.objects.length, 1)
  assert.deepEqual(opened.document.objects[0], rectangleOnly.objects[0])
})

test('New, create, edit, move, Undo/Redo, Save, and Open preserve text and object order', async () => {
  const initial = createUntitledProjectSession(800, 600)
  const history = new DocumentHistory()
  const rectangle = addRectangle(initial.document, { x: 10, y: 12, width: 100, height: 55 })
  history.recordChange(initial.document, rectangle)
  const withText = addTextObject(rectangle, { x: 140, y: 90, text: 'Привет\nlet answer = 42' })
  history.recordChange(rectangle, withText)
  const addedText = withText.objects[1]
  if (addedText.type !== 'text') assert.fail('Expected a text object')
  const edited = updateTextObject(withText, addedText.id, 'Здравствуй\nlet answer = "✓"')
  history.recordChange(withText, edited)
  const moved = moveObject(edited, addedText.id, { x: 200, y: 130 })
  history.recordChange(edited, moved)

  assert.equal(history.undo(moved), edited)
  const undoneEdit = history.undo(edited)
  assert.equal(undoneEdit, withText)
  assert.equal(undoneEdit?.objects[1].type, 'text')
  if (undoneEdit?.objects[1].type !== 'text') assert.fail('Expected text before editing')
  assert.equal(undoneEdit.objects[1].text, 'Привет\nlet answer = 42')
  assert.equal(history.redo(undoneEdit), edited)
  assert.equal(history.redo(edited), moved)
  const dirtySession = updateProjectSessionDocument(initial, moved, history.isDirty(moved))
  let manifestText = ''
  const saved = await saveProjectSession(dirtySession, {
    saveProject: async (request) => {
      manifestText = request.manifestText
      return { status: 'saved', projectRoot: '/saved', projectName: 'Text Project' }
    },
  })

  assert.equal(saved.status, 'saved')
  assert.equal(history.isDirty(moved), true)
  history.markSaved(moved)
  assert.equal(history.isDirty(moved), false)
  const reopened = openProjectSession(manifestText, '/saved')
  assert.equal(reopened.isDirty, false)
  assert.deepEqual(reopened.document.objects.map((object) => object.id), moved.objects.map((object) => object.id))
  assert.deepEqual(reopened.document.objects[0], rectangle.objects[0])
  assert.deepEqual(reopened.document.objects[1], {
    ...addedText,
    x: 200,
    y: 130,
    text: 'Здравствуй\nlet answer = "✓"',
  })
})
