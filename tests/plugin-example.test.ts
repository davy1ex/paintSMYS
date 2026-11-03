import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { DocumentHistory } from '../src/application/document-history'
import { createPluginCommandTransaction } from '../src/application/plugins/plugin-command-transaction'
import { openProjectSession } from '../src/application/project-session'
import { createProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'
import { createSceneDocument, validateSceneDocument, type RectangleObject, type SceneDocument, type TextObject } from '../src/core/document/scene-document'
import { getTextObjectBounds } from '../src/editor/workspace/rectangle-geometry'
import { renderSceneSvg } from '../src/editor/workspace/scene-svg-serialization'

type PluginCommandHost = {
  ui: { showForm: (schema: unknown) => Promise<unknown> }
  snapshotDocument: () => Promise<SceneDocument>
  addObjects: (objects: unknown) => Promise<void>
  showError: (message: string) => Promise<void>
}
type PluginEntry = {
  activate: (api: { registerCommand: (id: string, handler: (host: PluginCommandHost) => Promise<void>) => void }) => void
}

async function loadExampleCommand() {
  const source = await readFile(join(process.cwd(), 'examples/plugins/win95-window/index.js'), 'utf8')
  const sandbox: Record<string, unknown> = {}
  runInNewContext(source, sandbox)
  const plugin = sandbox.paintSMYSPlugin as PluginEntry | undefined
  assert.ok(plugin)
  const handlers: Array<(host: PluginCommandHost) => Promise<void>> = []
  plugin.activate({ registerCommand: (_id, handler) => { handlers.push(handler) } })
  const command = handlers[0]
  assert.ok(command)
  return command
}

function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }, inset = 0): boolean {
  return inner.x >= outer.x + inset && inner.y >= outer.y + inset &&
    inner.x + inner.width <= outer.x + outer.width - inset &&
    inner.y + inner.height <= outer.y + outer.height - inset
}

function isRectangle(object: { type: string }): object is RectangleObject {
  return object.type === 'rectangle'
}

function isText(object: { type: string }): object is TextObject {
  return object.type === 'text'
}

test('the Win95 window keeps its status bar and content inside one window with no extra desktop menu', async () => {
  const command = await loadExampleCommand()
  async function generate(document: SceneDocument, values: { windowTitle: string; welcomeMessage: string }): Promise<SceneDocument> {
    const transaction = createPluginCommandTransaction(document, () => undefined)
    await command({
      ui: { showForm: async () => ({ status: 'submitted', values }) },
      snapshotDocument: async () => transaction.snapshotDocument(),
      addObjects: async (objects: unknown) => transaction.addObjects(objects),
      showError: async (message: string) => assert.fail(message),
    })
    return validateSceneDocument(transaction.snapshotDocument())
  }

  const generated = await generate(createSceneDocument(800, 600), {
    windowTitle: 'Custom Program Manager title for Windows 95 2026',
    welcomeMessage: 'Welcome to your new Windows 95 desktop environment',
  })
  const { width: artboardWidth, height: artboardHeight } = generated.artboard
  const rectangles = generated.objects.filter(isRectangle)
  const texts = generated.objects.filter(isText)
  const windowFrame = rectangles.find((object) => object.fill.toLowerCase() === '#c0c0c0' && object.stroke.toLowerCase() === '#000000' && object.strokeWidth === 2)
  const titleBar = rectangles.find((object) => object.fill.toLowerCase() === '#000080')
  const clientArea = rectangles.find((object) => object.fill.toLowerCase() === '#ffffff' && object.stroke.toLowerCase() === '#808080')
  const titleText = texts.find((object) => object.text === 'Custom Program Manager title for Windows 95 2026')
  const statusText = texts.find((object) => object.text === '3 items')
  const statusBar = statusText && rectangles.find((object) => object.height === 18 && object.x < statusText.x && object.x + object.width > statusText.x)

  assert.ok(windowFrame, 'the composition has an identifiable outer window frame')
  assert.ok(titleBar && titleText, 'the submitted window title is present in the title bar')
  assert.ok(clientArea, 'the window has a client area')
  assert.ok(statusBar && statusText, 'the status bar and its label are present')
  assert.equal(texts.some(({ text }) => text === 'Start' || text.startsWith('Programs')), false, 'no external Start or Programs menu is generated')
  assert.equal(rectangles.some((object) => object.width > artboardWidth - 40 && object.fill.toLowerCase() === '#c0c0c0'), false, 'no full-width desktop menu frame is generated')

  const windowBounds = { x: windowFrame.x, y: windowFrame.y, width: windowFrame.width, height: windowFrame.height }
  const titleBarBounds = { x: titleBar.x, y: titleBar.y, width: titleBar.width, height: titleBar.height }
  const clientBounds = { x: clientArea.x, y: clientArea.y, width: clientArea.width, height: clientArea.height }
  const statusBounds = { x: statusBar.x, y: statusBar.y, width: statusBar.width, height: statusBar.height }

  assert.ok(windowFrame.x >= 0 && windowFrame.y >= 0 && windowFrame.x + windowFrame.width <= artboardWidth && windowFrame.y + windowFrame.height <= artboardHeight)
  assert.ok(contains(titleBarBounds, getTextObjectBounds(titleText), 2), 'a custom title stays inside the title bar')
  assert.ok(contains(windowBounds, statusBounds, 4), 'the status bar stays within the outer window border')
  assert.ok(statusBar.y >= clientArea.y + clientArea.height, 'the status bar sits below the client area')
  assert.ok(statusBar.y + statusBar.height <= windowFrame.y + windowFrame.height - 4, 'the status label row does not escape the window')
  assert.ok(windowFrame.y + windowFrame.height - statusBar.y - statusBar.height >= 8 && windowFrame.y + windowFrame.height - statusBar.y - statusBar.height <= 12, 'the status bar stays near the bottom inside the window')
  assert.ok(contains(statusBounds, getTextObjectBounds(statusText), 1), 'the status label stays inside the status bar')
  for (const text of texts.filter(({ text: value }) => value === 'Welcome to your new Windows 95 desktop environment' || value === 'Your desktop is ready.' || value === 'Double-click an icon to begin.')) {
    assert.ok(contains(clientBounds, getTextObjectBounds(text), 2), `client text stays inside the client area: ${text.text}`)
  }
  for (const object of generated.objects) {
    const bounds = isText(object)
      ? getTextObjectBounds(object)
      : { x: object.x, y: object.y, width: object.width, height: object.height }
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= artboardWidth && bounds.y + bounds.height <= artboardHeight, `visible object stays inside the Artboard: ${object.type}`)
  }
  assert.deepEqual(validateSceneDocument(generated), generated, 'the complete generated batch remains a valid SceneDocument')

  const minimumGenerated = await generate(createSceneDocument(404, 216), { windowTitle: 'Program Manager', welcomeMessage: 'Welcome to Windows 95' })
  const minimumRectangles = minimumGenerated.objects.filter(isRectangle)
  const minimumTexts = minimumGenerated.objects.filter(isText)
  const minimumClient = minimumRectangles.find((object) => object.fill.toLowerCase() === '#ffffff' && object.stroke.toLowerCase() === '#808080')
  const minimumWindow = minimumRectangles.find((object) => object.fill.toLowerCase() === '#c0c0c0' && object.stroke.toLowerCase() === '#000000' && object.strokeWidth === 2)
  assert.ok(minimumClient && minimumWindow, 'the minimum supported Artboard still fits one complete window')
  const minimumClientBounds = { x: minimumClient.x, y: minimumClient.y, width: minimumClient.width, height: minimumClient.height }
  for (const text of minimumTexts.filter(({ text: value }) => value === 'Welcome to Windows 95' || value === 'Your desktop is ready.' || value === 'Double-click an icon to begin.')) {
    assert.ok(contains(minimumClientBounds, getTextObjectBounds(text), 2), `minimum-size client text stays inside the client area: ${text.text}`)
  }
  assert.ok(minimumWindow.x >= 0 && minimumWindow.y >= 0 && minimumWindow.x + minimumWindow.width <= minimumGenerated.artboard.width && minimumWindow.y + minimumWindow.height <= minimumGenerated.artboard.height)

  const undersizedArtboard = createSceneDocument(400, 214)
  const sizeErrors: string[] = []
  let stagedOnUndersizedArtboard = false
  await command({
    ui: { showForm: async () => ({ status: 'submitted', values: { windowTitle: 'Program Manager', welcomeMessage: 'Welcome to Windows 95' } }) },
    snapshotDocument: async () => undersizedArtboard,
    addObjects: async () => { stagedOnUndersizedArtboard = true },
    showError: async (message: string) => { sizeErrors.push(message) },
  })
  assert.equal(stagedOnUndersizedArtboard, false)
  assert.match(sizeErrors[0] ?? '', /404 × 216 px/)

  for (const values of [
    { windowTitle: 'W'.repeat(100), welcomeMessage: 'Welcome to Windows 95' },
    { windowTitle: 'Program Manager', welcomeMessage: 'W'.repeat(60) },
  ]) {
    const textErrors: string[] = []
    let stagedOnTextOverflow = false
    await command({
      ui: { showForm: async () => ({ status: 'submitted', values }) },
      snapshotDocument: async () => createSceneDocument(800, 600),
      addObjects: async () => { stagedOnTextOverflow = true },
      showError: async (message: string) => { textErrors.push(message) },
    })
    assert.equal(stagedOnTextOverflow, false)
    assert.match(textErrors[0] ?? '', /too long/)
  }
})

test('the external Win95 example uses submitted values and creates one undoable, saveable scene batch', async () => {
  const command = await loadExampleCommand()
  const initial = createSceneDocument(800, 600)
  let committed = initial
  const transaction = createPluginCommandTransaction(initial, (document) => { committed = document })
  let requestedSchema: unknown
  const host = {
    ui: {
      showForm: async (schema: unknown) => {
        requestedSchema = schema
        return { status: 'submitted', values: { windowTitle: 'My Custom Window', welcomeMessage: 'Hello from my form' } }
      },
    },
    snapshotDocument: async () => transaction.snapshotDocument(),
    addObjects: async (objects: unknown) => transaction.addObjects(objects),
    showError: async () => undefined,
  }

  await command(host)
  assert.deepEqual(JSON.parse(JSON.stringify(requestedSchema)), {
    title: 'Generate Win95 Window',
    fields: [
      { id: 'windowTitle', type: 'text', label: 'Window title', defaultValue: 'Program Manager', required: true },
      { id: 'welcomeMessage', type: 'text', label: 'Welcome message', defaultValue: 'Welcome to Windows 95', required: true },
    ],
    submitLabel: 'Generate',
  })
  const generated = transaction.snapshotDocument()
  transaction.commit()
  assert.deepEqual(committed, generated)
  assert.ok(generated.objects.length > 10)
  const generatedText = generated.objects.filter((object) => object.type === 'text')
  assert.ok(generatedText.some((object) => object.type === 'text' && object.text === 'My Custom Window'))
  assert.ok(generatedText.some((object) => object.type === 'text' && object.text === 'Hello from my form'))

  const history = new DocumentHistory(initial)
  assert.equal(history.recordChange(initial, generated), true)
  assert.equal(history.undo(generated), initial)
  assert.deepEqual(history.redo(initial), generated)

  const manifestText = serializeProjectManifest(createProjectManifest('plugin-scene', 'Win95 Plugin', generated))
  const reopened = openProjectSession(manifestText, '/plugin-scene')
  assert.deepEqual(reopened.document, generated)
  const exportedSvg = renderSceneSvg(reopened.document)
  assert.match(exportedSvg, /My Custom Window/)
  assert.match(exportedSvg, /Hello from my form/)
})

test('Cancel in the external Win95 example stages no scene objects', async () => {
  const command = await loadExampleCommand()
  const initial = createSceneDocument(800, 600)
  const transaction = createPluginCommandTransaction(initial, () => assert.fail('Cancel must not publish a document.'))
  let addedObjects = false
  await command({
    ui: { showForm: async () => ({ status: 'cancelled' }) },
    snapshotDocument: async () => transaction.snapshotDocument(),
    addObjects: async (objects: unknown) => { addedObjects = true; transaction.addObjects(objects) },
    showError: async () => undefined,
  })
  assert.equal(addedObjects, false)
  transaction.commit()
})
