import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canCloseAfterSave, requiresCloseConfirmation } from '../src/application/project-close-policy'
import { createUntitledProjectSession, openProjectSession, type ProjectSession } from '../src/application/project-session'
import type { ProjectSavePort } from '../src/application/project-save-port'
import { saveProjectSession } from '../src/application/save-project-session'
import { CloseHandshake } from '../src/app/desktop/window/close-handshake'
import { createProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'

function cleanProject(): ProjectSession {
  const initial = createUntitledProjectSession(800, 600)
  return openProjectSession(serializeProjectManifest(createProjectManifest('saved-project', 'Saved', initial.document)), '/saved-project')
}

test('1. no active project allows closing without confirmation', () => {
  assert.equal(requiresCloseConfirmation(null), false)
})

test('2. a saved clean project closes without confirmation', () => {
  assert.equal(requiresCloseConfirmation(cleanProject()), false)
})

test('3. an unrooted project needs confirmation even when isDirty is false', () => {
  const session = { ...createUntitledProjectSession(800, 600), isDirty: false }
  assert.equal(requiresCloseConfirmation(session), true)
})

test('4. a dirty project needs confirmation', () => {
  assert.equal(requiresCloseConfirmation({ ...cleanProject(), isDirty: true }), true)
})

test('5. Cancel leaves the close handshake pending window open', () => {
  let requestId = 0
  let closeCount = 0
  const handshake = new CloseHandshake({
    requestRendererDecision: (id) => { requestId = id },
    closeWindow: () => { closeCount += 1 },
    onFailure: () => assert.fail('Cancel is not a handshake failure'),
  })

  assert.equal(handshake.handleClose(), false)
  handshake.respond(requestId, 'cancel')
  assert.equal(closeCount, 0)
  assert.equal(handshake.handleClose(), false)
  handshake.respond(requestId, 'cancel')
})

test('6. Don\'t Save allows the close handshake', () => {
  let requestId = 0
  let closeCount = 0
  const handshake = new CloseHandshake({
    requestRendererDecision: (id) => { requestId = id },
    closeWindow: () => { closeCount += 1 },
    onFailure: () => assert.fail('An allow decision is not a handshake failure'),
  })

  assert.equal(handshake.handleClose(), false)
  handshake.respond(requestId, 'allow')
  assert.equal(closeCount, 1)
  assert.equal(handshake.handleClose(), true)
})

test('7. a successful clean Save can allow closing', async () => {
  const session = createUntitledProjectSession(800, 600)
  const savePort: ProjectSavePort = {
    saveProject: async () => ({ status: 'saved', projectRoot: '/saved-project', projectName: 'Saved' }),
  }
  const result = await saveProjectSession(session, savePort)
  assert.equal(canCloseAfterSave(result, result.status === 'saved' ? result.session : null), true)
})

test('8. cancelling Save As keeps the close request denied', async () => {
  const session = createUntitledProjectSession(800, 600)
  const savePort: ProjectSavePort = { saveProject: async () => ({ status: 'cancelled' }) }
  const result = await saveProjectSession(session, savePort)
  assert.equal(canCloseAfterSave(result, session), false)
})

test('9. a failed Save keeps the close request denied', async () => {
  const session = createUntitledProjectSession(800, 600)
  const savePort: ProjectSavePort = { saveProject: async () => ({ status: 'error', message: 'Disk is full.' }) }
  const result = await saveProjectSession(session, savePort)
  assert.equal(canCloseAfterSave(result, session), false)
})

test('10. a successful write with newer document changes keeps the close request denied', async () => {
  const session = createUntitledProjectSession(800, 600)
  const savePort: ProjectSavePort = {
    saveProject: async () => ({ status: 'saved', projectRoot: '/saved-project', projectName: 'Saved' }),
  }
  const result = await saveProjectSession(session, savePort)
  if (result.status !== 'saved') assert.fail('Save should succeed')
  const changedWhileSaving: ProjectSession = {
    ...result.session,
    isDirty: true,
    document: { ...result.session.document, artboard: { ...result.session.document.artboard, backgroundColor: '#abc' } },
  }
  assert.equal(canCloseAfterSave(result, changedWhileSaving), false)
})

test('11. repeated close events do not send a second renderer request', () => {
  let requestCount = 0
  let requestId = 0
  const handshake = new CloseHandshake({
    requestRendererDecision: (id) => { requestCount += 1; requestId = id },
    closeWindow: () => undefined,
    onFailure: () => assert.fail('No failure expected'),
  })

  assert.equal(handshake.handleClose(), false)
  assert.equal(handshake.handleClose(), false)
  assert.equal(requestCount, 1)
  handshake.respond(requestId, 'cancel')
})

test('12. an IPC send failure never allows closing and clears the pending request', () => {
  let failureMessage = ''
  let closeCount = 0
  const handshake = new CloseHandshake({
    requestRendererDecision: () => { throw new Error('IPC unavailable') },
    closeWindow: () => { closeCount += 1 },
    onFailure: (_requestId, message) => { failureMessage = message },
  })

  assert.equal(handshake.handleClose(), false)
  assert.match(failureMessage, /kept open/)
  assert.equal(closeCount, 0)
})

test('a missing renderer response times out safely and allows a fresh close attempt', async () => {
  let requestCount = 0
  let failureCount = 0
  const handshake = new CloseHandshake({
    requestRendererDecision: () => { requestCount += 1 },
    closeWindow: () => assert.fail('A timeout must not allow closing'),
    onFailure: () => { failureCount += 1 },
    timeoutMs: 5,
  })

  assert.equal(handshake.handleClose(), false)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(failureCount, 1)
  assert.equal(handshake.handleClose(), false)
  assert.equal(requestCount, 2)
  handshake.respond(2, 'cancel')
})
