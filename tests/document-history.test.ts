import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DocumentHistory } from '../src/application/document-history'
import { mergeSavedProjectSession, saveProjectSession } from '../src/application/save-project-session'
import { createUntitledProjectSession, openProjectSession, updateProjectSessionDocument } from '../src/application/project-session'
import { addRectangle, createSceneDocument, moveObject, removeObject, type SceneDocument } from '../src/core/document/scene-document'

function withRectangle(document: SceneDocument, x: number) {
  return addRectangle(document, { x, y: 10, width: 20, height: 15 })
}

test('new history starts empty and the first change enables Undo', () => {
  const document = createSceneDocument(800, 600)
  const changed = withRectangle(document, 10)
  const history = new DocumentHistory()

  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, false)
  assert.equal(history.recordChange(document, changed), true)
  assert.equal(history.canUndo, true)
  assert.equal(history.undo(changed), document)
})

test('Undo and Redo restore immutable snapshots with IDs and object order intact', () => {
  const document = createSceneDocument(800, 600)
  const first = withRectangle(document, 10)
  const second = withRectangle(first, 40)
  const history = new DocumentHistory()
  history.recordChange(document, first)
  history.recordChange(first, second)

  assert.equal(history.undo(second), first)
  assert.equal(history.canRedo, true)
  assert.equal(history.redo(first), second)
  assert.deepEqual(second.objects.map((object) => object.id), [first.objects[0].id, second.objects[1].id])
})

test('one rectangle move creates one Undo entry and supports Redo', () => {
  const saved = withRectangle(createSceneDocument(800, 600), 10)
  const rectangle = saved.objects[0]
  const moved = moveObject(saved, rectangle.id, { x: 70, y: 90 })
  const history = new DocumentHistory(saved)

  assert.equal(history.recordChange(saved, moved), true)
  assert.equal(history.recordChange(moved, moveObject(moved, rectangle.id, { x: 70, y: 90 })), false)
  assert.equal(history.undo(moved), saved)
  assert.equal(history.canUndo, false)
  assert.equal(history.isDirty(saved), false)
  assert.equal(history.redo(saved), moved)
  assert.equal(history.isDirty(moved), true)
})

test('moving, saving, Undo, and Redo track the saved position as the dirty baseline', () => {
  const initial = withRectangle(createSceneDocument(800, 600), 10)
  const rectangle = initial.objects[0]
  const moved = moveObject(initial, rectangle.id, { x: 60, y: 80 })
  const history = new DocumentHistory(initial)
  history.recordChange(initial, moved)
  history.markSaved(moved)

  assert.equal(history.undo(moved), initial)
  assert.equal(history.isDirty(initial), true)
  assert.equal(history.redo(initial), moved)
  assert.equal(history.isDirty(moved), false)
})

test('a new edit after Undo clears Redo and a no-op creates no history entry', () => {
  const document = createSceneDocument(800, 600)
  const first = withRectangle(document, 10)
  const second = withRectangle(first, 40)
  const replacement = withRectangle(first, 70)
  const history = new DocumentHistory()
  history.recordChange(document, first)
  history.recordChange(first, second)
  assert.equal(history.undo(second), first)

  assert.equal(history.recordChange(first, first), false)
  assert.equal(history.canRedo, true)
  history.recordChange(first, replacement)
  assert.equal(history.canRedo, false)
  assert.equal(history.undo(replacement), first)
})

test('Undo and Redo on empty stacks do not change the supplied document', () => {
  const document = createSceneDocument(800, 600)
  const history = new DocumentHistory()

  assert.equal(history.undo(document), null)
  assert.equal(history.redo(document), null)
  assert.equal(history.canUndo, false)
  assert.equal(history.canRedo, false)
})

test('history limit trims oldest undo snapshots without changing current documents', () => {
  const first = createSceneDocument(800, 600)
  const second = withRectangle(first, 10)
  const third = withRectangle(second, 40)
  const fourth = withRectangle(third, 70)
  const history = new DocumentHistory(first, 2)
  history.recordChange(first, second)
  history.recordChange(second, third)
  history.recordChange(third, fourth)

  assert.equal(history.undo(fourth), third)
  assert.equal(history.undo(third), second)
  assert.equal(history.undo(second), null)
  assert.equal(history.isDirty(first), false)
  assert.equal(fourth.objects.length, 3)
})

test('each new project can start with an independent empty history', () => {
  const firstProject = createUntitledProjectSession(800, 600)
  const secondProject = createUntitledProjectSession(800, 600)
  const firstHistory = new DocumentHistory()
  const secondHistory = new DocumentHistory()
  const changed = withRectangle(firstProject.document, 10)
  firstHistory.recordChange(firstProject.document, changed)

  assert.equal(firstHistory.canUndo, true)
  assert.equal(secondHistory.canUndo, false)
  assert.notEqual(firstProject.projectId, secondProject.projectId)
})

test('Undo returns to the saved baseline and Redo becomes dirty again', () => {
  const saved = withRectangle(createSceneDocument(800, 600), 10)
  const edited = withRectangle(saved, 40)
  const history = new DocumentHistory(saved)
  history.recordChange(saved, edited)

  assert.equal(history.isDirty(edited), true)
  assert.equal(history.undo(edited), saved)
  assert.equal(history.isDirty(saved), false)
  assert.equal(history.redo(saved), edited)
  assert.equal(history.isDirty(edited), true)
})

test('saving a newer state makes Undo dirty and Redo clean', () => {
  const initial = createSceneDocument(800, 600)
  const first = withRectangle(initial, 10)
  const second = withRectangle(first, 40)
  const history = new DocumentHistory(initial)
  history.recordChange(initial, first)
  history.recordChange(first, second)
  history.markSaved(second)

  assert.equal(history.undo(second), first)
  assert.equal(history.isDirty(first), true)
  assert.equal(history.redo(first), second)
  assert.equal(history.isDirty(second), false)
})

test('failed or cancelled saves do not move the saved baseline', async () => {
  const session = createUntitledProjectSession(800, 600)
  const changed = withRectangle(session.document, 10)
  const history = new DocumentHistory()
  history.recordChange(session.document, changed)
  const changedSession = updateProjectSessionDocument(session, changed)

  const failed = await saveProjectSession(changedSession, {
    saveProject: async () => ({ status: 'error', message: 'Disk is full.' }),
  })
  const cancelled = await saveProjectSession(changedSession, {
    saveProject: async () => ({ status: 'cancelled' }),
  })
  if (failed.status === 'saved' || cancelled.status === 'saved') history.markSaved(changed)

  assert.equal(failed.status, 'error')
  assert.equal(cancelled.status, 'cancelled')
  assert.equal(history.isDirty(changed), true)
})

test('a snapshot saved during later edits becomes the baseline, and Undo back to it is clean', async () => {
  const session = createUntitledProjectSession(800, 600)
  const documentA = withRectangle(session.document, 10)
  const snapshot = updateProjectSessionDocument(session, documentA)
  const history = new DocumentHistory()
  history.recordChange(session.document, documentA)
  let finishWrite: ((result: { status: 'saved'; projectRoot: string; projectName: string }) => void) | undefined
  const savePromise = saveProjectSession(snapshot, {
    saveProject: () => new Promise((resolve) => { finishWrite = resolve }),
  })

  const documentB = withRectangle(documentA, 40)
  history.recordChange(documentA, documentB)
  finishWrite?.({ status: 'saved', projectRoot: '/project', projectName: 'Project' })
  const result = await savePromise
  assert.equal(result.status, 'saved')
  if (result.status !== 'saved') return

  history.markSaved(snapshot.document)
  assert.equal(history.isDirty(documentB), true)
  assert.equal(history.undo(documentB), documentA)
  assert.equal(history.isDirty(documentA), false)
})

test('a Save in flight cannot replace a later rectangle position', async () => {
  const session = createUntitledProjectSession(800, 600)
  const withRectangle = addRectangle(session.document, { x: 10, y: 20, width: 40, height: 30 })
  const savedSnapshot = updateProjectSessionDocument(session, withRectangle)
  const history = new DocumentHistory()
  history.recordChange(session.document, withRectangle)
  let finishWrite: ((result: { status: 'saved'; projectRoot: string; projectName: string }) => void) | undefined
  const savePromise = saveProjectSession(savedSnapshot, {
    saveProject: () => new Promise((resolve) => { finishWrite = resolve }),
  })

  const moved = moveObject(withRectangle, withRectangle.objects[0].id, { x: 90, y: 110 })
  history.recordChange(withRectangle, moved)
  const currentSession = updateProjectSessionDocument(savedSnapshot, moved)
  finishWrite?.({ status: 'saved', projectRoot: '/project', projectName: 'Project' })
  const writeResult = await savePromise

  assert.equal(writeResult.status, 'saved')
  if (writeResult.status !== 'saved') return
  const merged = mergeSavedProjectSession(savedSnapshot, currentSession, writeResult.session)
  history.markSaved(savedSnapshot.document)
  assert.equal(merged?.document, moved)
  assert.equal(merged?.isDirty, true)
  assert.equal(history.undo(moved), withRectangle)
  assert.equal(history.isDirty(withRectangle), false)
})

test('saving one session does not change another session history baseline', () => {
  const first = createSceneDocument(800, 600)
  const second = createSceneDocument(800, 600)
  const firstChanged = withRectangle(first, 10)
  const secondChanged = withRectangle(second, 40)
  const firstHistory = new DocumentHistory(first)
  const secondHistory = new DocumentHistory(second)
  firstHistory.markSaved(firstChanged)

  assert.equal(firstHistory.isDirty(firstChanged), false)
  assert.equal(secondHistory.isDirty(second), false)
  assert.equal(secondHistory.isDirty(secondChanged), true)
})

test('New, Rectangle A, Rectangle B, Delete B, Undo, Redo, Save, and Open preserve saved content', async () => {
  const session = createUntitledProjectSession(800, 600)
  const history = new DocumentHistory()
  const documentA = withRectangle(session.document, 10)
  history.recordChange(session.document, documentA)
  const documentAB = withRectangle(documentA, 40)
  history.recordChange(documentA, documentAB)
  const rectangleA = documentAB.objects[0]
  const rectangleB = documentAB.objects[1]
  const documentAfterDelete = removeObject(documentAB, rectangleB.id)
  history.recordChange(documentAB, documentAfterDelete)

  const afterUndo = history.undo(documentAfterDelete)
  assert.equal(afterUndo, documentAB)
  assert.deepEqual(afterUndo?.objects.map((object) => object.id), [rectangleA.id, rectangleB.id])
  const currentDocument = history.redo(afterUndo!)
  assert.equal(currentDocument, documentAfterDelete)
  assert.deepEqual(currentDocument?.objects.map((object) => object.id), [rectangleA.id])

  const currentSession = updateProjectSessionDocument(session, currentDocument!)
  let manifestText = ''
  const result = await saveProjectSession(currentSession, {
    saveProject: async (request) => {
      manifestText = request.manifestText
      return { status: 'saved', projectRoot: '/project', projectName: 'Project' }
    },
  })
  assert.equal(result.status, 'saved')
  if (result.status !== 'saved') return
  history.markSaved(currentSession.document)
  assert.equal(history.isDirty(currentDocument!), false)

  const opened = openProjectSession(manifestText, '/project')
  const openedHistory = new DocumentHistory(opened.document)
  assert.deepEqual(opened.document.objects.map((object) => object.id), [rectangleA.id])
  assert.equal(opened.document.objects.length, 1)
  assert.equal(opened.isDirty, false)
  assert.equal(openedHistory.canUndo, false)
  assert.equal(openedHistory.canRedo, false)
})
