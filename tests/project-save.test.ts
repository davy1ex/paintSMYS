import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { saveProjectAsFolder, saveExistingProjectFolder, readProjectFolder } from '../src/app/desktop/project-storage'
import { mergeSavedProjectSession, saveProjectSession } from '../src/application/save-project-session'
import type { ProjectSavePort, ProjectSaveRequest } from '../src/application/project-save-port'
import { createUntitledProjectSession, openProjectSession, updateProjectSessionDocument, type ProjectSession } from '../src/application/project-session'
import { addRectangle, addTextObject, moveObject, removeObject } from '../src/core/document/scene-document'
import { parseProjectManifest } from '../src/core/project/project-manifest'

async function withTempDirectory(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'paint-smys-save-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function diskSavePort(targetPath: string): ProjectSavePort {
  return {
    saveProject: async (request: ProjectSaveRequest) => {
      try {
        const saved = request.mode === 'save-as'
          ? await saveProjectAsFolder(targetPath, request.manifestText, false)
          : await saveExistingProjectFolder(request.projectRoot!, request.manifestText)
        return { status: 'saved', ...saved }
      } catch (error) {
        return { status: 'error', message: error instanceof Error ? error.message : 'Save failed.' }
      }
    },
  }
}

test('New 1920×1080 project saves to a project folder and restores the Scene ID and Artboard', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const target = join(parent, 'Full HD')
    const original = createUntitledProjectSession(1920, 1080)
    const saved = await saveProjectSession(original, diskSavePort(target))

    assert.equal(saved.status, 'saved')
    if (saved.status !== 'saved') return
    assert.equal(saved.session.projectRoot, target)
    assert.equal(saved.session.projectName, 'Full HD')
    assert.equal(saved.session.isDirty, false)
    assert.deepEqual((await readdir(target)).sort(), ['assets', 'project.json'])

    const { manifestText } = await readProjectFolder(target)
    const manifest = parseProjectManifest(manifestText)
    assert.equal(manifest.scene.id, original.document.id)
    assert.deepEqual(manifest.scene.artboard, { width: 1920, height: 1080, backgroundColor: '#ffffff' })
    const reopened = openProjectSession(manifestText, target)
    assert.equal(reopened.document.id, original.document.id)
    assert.equal(reopened.document.artboard.width, 1920)
    assert.equal(reopened.document.artboard.height, 1080)
  })
})

test('Styled Text runs save into project.json and return after Open as one object', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const target = join(parent, 'Styled Text')
    const original = createUntitledProjectSession(640, 480)
    const source = '  let greeting = "Привет 😀"\n    print(greeting)\n'
    const greetingStart = source.indexOf('Привет')
    const created = addTextObject(original.document, {
      x: 24,
      y: 32,
      text: source,
      runs: [
        { start: 2, end: 15, color: '#0000cc' },
        { start: greetingStart, end: greetingStart + 'Привет 😀'.length, color: '#008000' },
      ],
    })
    const saved = await saveProjectSession(
      updateProjectSessionDocument(original, created),
      diskSavePort(target),
    )

    assert.equal(saved.status, 'saved')
    if (saved.status !== 'saved') return
    assert.equal(saved.session.projectRoot, target)
    assert.equal(saved.session.isDirty, false)
    const { manifestText } = await readProjectFolder(target)
    const manifest = parseProjectManifest(manifestText)
    assert.equal(manifest.scene.objects.length, 1)
    assert.equal(manifest.scene.objects[0].type, 'text')
    if (manifest.scene.objects[0].type !== 'text') assert.fail('Expected a text object')
    assert.equal(manifest.scene.objects[0].text, source)
    assert.deepEqual(manifest.scene.objects[0].runs, [
      { start: 2, end: 15, color: '#0000cc' },
      { start: greetingStart, end: greetingStart + 'Привет 😀'.length, color: '#008000' },
    ])
    assert.equal(manifestText.includes('<tspan'), false)

    const reopened = openProjectSession(manifestText, target)
    assert.equal(reopened.document.objects.length, 1)
    assert.deepEqual(reopened.document.objects[0], manifest.scene.objects[0])
  })
})

test('New Project draws one Rectangle, becomes dirty, then Save and Open restore its full data', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const target = join(parent, 'Rectangle scene')
    const session = createUntitledProjectSession(1920, 1080)
    const documentWithRectangle = addRectangle(session.document, { x: 10, y: 20, width: 80, height: 40 })
    const withRectangle = updateProjectSessionDocument(session, documentWithRectangle)
    const rectangle = documentWithRectangle.objects[0]
    assert.equal(withRectangle.isDirty, true)
    assert.equal(session.document.objects.length, 0)

    const result = await saveProjectSession(withRectangle, diskSavePort(target))
    assert.equal(result.status, 'saved')
    const { manifestText } = await readProjectFolder(target)
    const opened = openProjectSession(manifestText, target)
    assert.deepEqual(opened.document.objects, [rectangle])
    assert.equal(opened.document.id, session.document.id)
    assert.equal(opened.isDirty, false)
    assert.equal(opened.document.objects[0].id, rectangle.id)
    const openedRectangle = opened.document.objects[0]
    assert.equal(openedRectangle.type, 'rectangle')
    if (openedRectangle.type !== 'rectangle') assert.fail('Expected the saved Rectangle object')
    assert.deepEqual(
      (({ x, y, width, height, fill, stroke, strokeWidth }) => ({ x, y, width, height, fill, stroke, strokeWidth }))(openedRectangle),
      { x: 10, y: 20, width: 80, height: 40, fill: '#ffffff', stroke: '#000000', strokeWidth: 1 },
    )
  })
})

test('Save and Open restore a moved Rectangle position', async () => {
  await withTempDirectory(async (directory) => {
    const target = join(directory, 'Moved rectangle')
    const session = createUntitledProjectSession(800, 600)
    const withRectangle = addRectangle(session.document, { x: 10, y: 20, width: 80, height: 40 })
    const rectangle = withRectangle.objects[0]
    const moved = moveObject(withRectangle, rectangle.id, { x: 140, y: -35 })
    const result = await saveProjectSession(updateProjectSessionDocument(session, moved), diskSavePort(target))

    assert.equal(result.status, 'saved')
    if (result.status !== 'saved') return
    const reopened = openProjectSession((await readProjectFolder(target)).manifestText, target)
    assert.equal(reopened.isDirty, false)
    assert.deepEqual(reopened.document.objects, moved.objects)
    assert.equal(reopened.document.objects[0].x, 140)
    assert.equal(reopened.document.objects[0].y, -35)
  })
})

test('delete after Save marks the session dirty and a second Save keeps the object deleted after Open', async () => {
  await withTempDirectory(async (directory) => {
    const target = join(directory, 'Delete flow')
    const initial = createUntitledProjectSession(800, 600)
    const withFirst = addRectangle(initial.document, { x: 10, y: 20, width: 80, height: 40 })
    const withTwoRectangles = addRectangle(withFirst, { x: 120, y: 140, width: 50, height: 30 })
    const savedBeforeDelete = await saveProjectSession(
      updateProjectSessionDocument(initial, withTwoRectangles),
      diskSavePort(target),
    )
    assert.equal(savedBeforeDelete.status, 'saved')
    if (savedBeforeDelete.status !== 'saved') return

    const removedId = withTwoRectangles.objects[1].id
    const afterDelete = updateProjectSessionDocument(
      savedBeforeDelete.session,
      removeObject(savedBeforeDelete.session.document, removedId),
    )
    assert.equal(afterDelete.isDirty, true)
    assert.deepEqual(afterDelete.document.objects.map((object) => object.id), [withTwoRectangles.objects[0].id])

    const savedAfterDelete = await saveProjectSession(afterDelete, diskSavePort(target))
    assert.equal(savedAfterDelete.status, 'saved')
    if (savedAfterDelete.status !== 'saved') return
    assert.equal(savedAfterDelete.session.isDirty, false)

    const { manifestText } = await readProjectFolder(target)
    const reopened = openProjectSession(manifestText, target)
    assert.deepEqual(reopened.document.objects.map((object) => object.id), [withTwoRectangles.objects[0].id])
    assert.deepEqual(reopened.document.artboard, initial.document.artboard)
  })
})

test('repeat Save reuses projectRoot while Save As creates a distinct project', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const firstRoot = join(parent, 'First')
    const secondRoot = join(parent, 'Second')
    const initial = createUntitledProjectSession(1920, 1080)
    const first = await saveProjectSession(initial, diskSavePort(firstRoot))
    assert.equal(first.status, 'saved')
    if (first.status !== 'saved') return

    const changed: ProjectSession = {
      ...first.session,
      isDirty: true,
      document: { ...first.session.document, artboard: { ...first.session.document.artboard, backgroundColor: '#abc' } },
    }
    const repeat = await saveProjectSession(changed, diskSavePort(secondRoot))
    assert.equal(repeat.status, 'saved')
    if (repeat.status !== 'saved') return
    assert.equal(repeat.session.projectRoot, firstRoot)
    assert.equal(parseProjectManifest((await readProjectFolder(firstRoot)).manifestText).scene.artboard.backgroundColor, '#abc')

    const copy = await saveProjectSession(repeat.session, diskSavePort(secondRoot), 'save-as')
    assert.equal(copy.status, 'saved')
    if (copy.status !== 'saved') return
    assert.equal(copy.session.projectRoot, secondRoot)
    assert.notEqual(copy.session.projectId, repeat.session.projectId)
    assert.equal(parseProjectManifest((await readProjectFolder(secondRoot)).manifestText).scene.id, initial.document.id)
  })
})

test('cancelled Save As and failed saves leave ProjectSession dirty and unchanged', async () => {
  const original = createUntitledProjectSession(1920, 1080)
  const cancelledPort: ProjectSavePort = { saveProject: async () => ({ status: 'cancelled' }) }
  assert.deepEqual(await saveProjectSession(original, cancelledPort), { status: 'cancelled' })
  assert.equal(original.projectRoot, null)
  assert.equal(original.isDirty, true)

  const failedPort: ProjectSavePort = { saveProject: async () => ({ status: 'error', message: 'Disk is full.' }) }
  assert.deepEqual(await saveProjectSession(original, failedPort), { status: 'error', message: 'Disk is full.' })
  assert.equal(original.projectRoot, null)
  assert.equal(original.isDirty, true)
})

test('a completed write cannot mark a newer document version as saved', async () => {
  const snapshot = createUntitledProjectSession(1920, 1080)
  const savedSnapshot: ProjectSession = { ...snapshot, projectRoot: '/project', projectName: 'Project', isDirty: false }
  const newer: ProjectSession = {
    ...snapshot,
    document: { ...snapshot.document, artboard: { ...snapshot.document.artboard, backgroundColor: '#abc' } },
    isDirty: true,
  }
  const merged = mergeSavedProjectSession(snapshot, newer, savedSnapshot)
  assert.equal(merged?.document, newer.document)
  assert.equal(merged?.isDirty, true)
  assert.equal(mergeSavedProjectSession(snapshot, null, savedSnapshot), null)
})

test('deleting an object while Save is in flight keeps the newer document dirty', async () => {
  const initial = createUntitledProjectSession(800, 600)
  const withRectangle = addRectangle(initial.document, { x: 10, y: 20, width: 80, height: 40 })
  const snapshot = updateProjectSessionDocument(initial, withRectangle)
  let finishWrite: ((result: { status: 'saved'; projectRoot: string; projectName: string }) => void) | undefined
  const saveInFlight = saveProjectSession(snapshot, {
    saveProject: () => new Promise((resolve) => { finishWrite = resolve }),
  })

  const afterDelete = updateProjectSessionDocument(snapshot, removeObject(snapshot.document, withRectangle.objects[0].id))
  finishWrite?.({ status: 'saved', projectRoot: '/project', projectName: 'Project' })
  const writeResult = await saveInFlight
  assert.equal(writeResult.status, 'saved')
  if (writeResult.status !== 'saved') return

  const merged = mergeSavedProjectSession(snapshot, afterDelete, writeResult.session)
  assert.equal(merged?.document, afterDelete.document)
  assert.equal(merged?.document.objects.length, 0)
  assert.equal(merged?.isDirty, true)
})

test('Save As refuses an existing project without consent and does not replace its manifest', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const target = join(parent, 'Existing')
    const first = await saveProjectAsFolder(target, JSON.stringify({
      format: 'paintSMYS', formatVersion: 1, project: { id: 'one', name: 'Existing' },
      scene: createUntitledProjectSession(1920, 1080).document,
    }), false)
    const before = await readFile(join(first.projectRoot, 'project.json'), 'utf8')
    const other = createUntitledProjectSession(1280, 720)
    await assert.rejects(saveProjectAsFolder(target, JSON.stringify({
      format: 'paintSMYS', formatVersion: 1, project: { id: 'two', name: 'Other' }, scene: other.document,
    }), false), /already exists/)
    assert.equal(await readFile(join(first.projectRoot, 'project.json'), 'utf8'), before)
  })
})

test('Save As does not write into arbitrary files or folders', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const arbitraryFolder = join(parent, 'Documents')
    await mkdir(arbitraryFolder)
    const notePath = join(arbitraryFolder, 'notes.txt')
    await writeFile(notePath, 'keep this file')
    const arbitraryFile = join(parent, 'project-name')
    await writeFile(arbitraryFile, 'also keep this file')
    const session = createUntitledProjectSession(1920, 1080)
    const manifestText = JSON.stringify({
      format: 'paintSMYS', formatVersion: 1, project: { id: 'new', name: 'New' }, scene: session.document,
    })

    await assert.rejects(saveProjectAsFolder(arbitraryFolder, manifestText, false), /not a saved paintSMYS project/)
    await assert.rejects(saveProjectAsFolder(arbitraryFile, manifestText, false), /file already exists/)
    assert.equal(await readFile(notePath, 'utf8'), 'keep this file')
    assert.equal(await readFile(arbitraryFile, 'utf8'), 'also keep this file')
  })
})

test('filesystem errors preserve the previous project.json', async () => {
  await withTempDirectory(async (directory) => {
    const parent = join(directory, 'projects')
    await mkdir(parent)
    const target = join(parent, 'Safe')
    const session = createUntitledProjectSession(1920, 1080)
    const saved = await saveProjectAsFolder(target, JSON.stringify({
      format: 'paintSMYS', formatVersion: 1, project: { id: session.projectId, name: 'Safe' }, scene: session.document,
    }), false)
    const manifestPath = join(saved.projectRoot, 'project.json')
    const previous = await readFile(manifestPath, 'utf8')
    await rm(join(saved.projectRoot, 'assets'), { recursive: true })
    await writeFile(join(saved.projectRoot, 'assets'), 'user file')

    await assert.rejects(saveExistingProjectFolder(saved.projectRoot, JSON.stringify({
      format: 'paintSMYS', formatVersion: 1, project: { id: 'changed', name: 'Safe' },
      scene: createUntitledProjectSession(1280, 720).document,
    })))
    assert.equal(await readFile(manifestPath, 'utf8'), previous)
  })
})
