import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { DocumentHistory } from '../src/application/document-history'
import { createPluginCommandTransaction } from '../src/application/plugins/plugin-command-transaction'
import { openProjectSession } from '../src/application/project-session'
import { createProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'
import { createSceneDocument, type SceneDocument } from '../src/core/document/scene-document'
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
