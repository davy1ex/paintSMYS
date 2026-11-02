import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { test } from 'node:test'
import { createPluginCommandTransaction } from '../src/application/plugins/plugin-command-transaction'
import { MAX_PLUGIN_SOURCE_BYTES } from '../src/application/plugins/plugin-api'
import { loadInstalledPlugins } from '../src/app/desktop/plugin-loader'
import { DocumentHistory } from '../src/application/document-history'
import { openProjectSession } from '../src/application/project-session'
import { createProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'
import { createSceneDocument, type NewSceneObject, type SceneDocument, type TextObject } from '../src/core/document/scene-document'
import { renderSceneSvg } from '../src/editor/workspace/scene-svg-serialization'

type FormResult =
  | { status: 'submitted'; values: Record<string, string> }
  | { status: 'cancelled' }

type PluginHost = {
  ui: { showForm: (schema: unknown) => Promise<FormResult> }
  snapshotDocument: () => Promise<SceneDocument>
  addObjects: (objects: unknown) => Promise<void>
  showError: (message: string) => Promise<void>
}

type PluginCommand = (host: PluginHost) => Promise<void>
type PluginEntry = {
  activate: (api: { registerCommand: (id: string, handler: PluginCommand) => void }) => void
}

const pluginPath = join(process.cwd(), 'examples/plugins/code-card/index.js')
const manifestPath = join(process.cwd(), 'examples/plugins/code-card/manifest.json')

async function loadCodeCardCommand(): Promise<PluginCommand> {
  const source = await readFile(pluginPath, 'utf8')
  const sandbox: Record<string, unknown> = {}
  runInNewContext(source, sandbox, { timeout: 10_000 })
  const plugin = sandbox.paintSMYSPlugin as PluginEntry | undefined
  assert.ok(plugin)

  const commands = new Map<string, PluginCommand>()
  plugin.activate({ registerCommand: (id, handler) => commands.set(id, handler) })
  const command = commands.get('generate-code-card')
  assert.ok(command)
  return command
}

function formValues(language: string, sourceCode: string, windowTitle = 'My Code Window'): FormResult {
  return { status: 'submitted', values: { windowTitle, language, sourceCode } }
}

async function generate(
  command: PluginCommand,
  result: FormResult,
  document = createSceneDocument(1280, 720),
) {
  let schema: unknown
  let addedObjects: unknown[] = []
  const errors: string[] = []
  let snapshotCount = 0
  try {
    await command({
      ui: {
        showForm: async (value) => {
          schema = value
          return result
        },
      },
      snapshotDocument: async () => {
        snapshotCount += 1
        return document
      },
      addObjects: async (objects) => {
        assert.ok(Array.isArray(objects))
        addedObjects = objects
      },
      showError: async (message) => { errors.push(message) },
    })
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { schema, addedObjects, errors, snapshotCount }
}

function getCodeObject(objects: unknown[], expectedText: string): TextObject {
  const object = objects.find((item): item is TextObject => (
    typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' &&
    'text' in item && item.text === expectedText
  ))
  assert.ok(object, 'expected the raw source to be stored as a TextObject')
  return object
}

function assertValidRuns(text: string, runs: NonNullable<TextObject['runs']>): void {
  let previousEnd = 0
  for (const run of runs) {
    assert.ok(Number.isInteger(run.start) && Number.isInteger(run.end))
    assert.ok(run.start >= previousEnd && run.end > run.start && run.end <= text.length)
    assert.match(run.color, /^#[\da-f]{6}$/i)
    for (const offset of [run.start, run.end]) {
      if (offset > 0 && offset < text.length) {
        const previous = text.charCodeAt(offset - 1)
        const next = text.charCodeAt(offset)
        assert.ok(!(previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff))
      }
    }
    previousEnd = run.end
  }
}

test('the installable bundle is self-contained and fits the isolated plugin source limit', async () => {
  const [manifestText, source, sourceInfo, notices, runtimeHtml, catalog] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(pluginPath, 'utf8'),
    stat(pluginPath),
    readFile(join(process.cwd(), 'examples/plugins/code-card/THIRD_PARTY_NOTICES.md'), 'utf8'),
    readFile(join(process.cwd(), 'src/app/desktop/plugins/runtime-assets/plugin-runtime.html'), 'utf8'),
    loadInstalledPlugins(join(process.cwd(), 'examples/plugins')),
  ])
  const manifest = JSON.parse(manifestText) as { entry: string; id: string; apiVersion: number }
  assert.equal(manifest.id, 'com.paintsmys.code-card')
  assert.equal(manifest.apiVersion, 0)
  assert.equal(manifest.entry, 'index.js')
  assert.ok(sourceInfo.size <= MAX_PLUGIN_SOURCE_BYTES)
  assert.doesNotMatch(source, /https?:\/\/(?:cdn\.|unpkg\.com|esm\.sh)/i)
  assert.doesNotMatch(source, /WebAssembly|fetch\s*\(|XMLHttpRequest/)
  assert.match(source, /globalThis\.paintSMYSPlugin/)
  assert.match(notices, /MIT License/)
  assert.match(runtimeHtml, /connect-src 'none'/)
  assert.match(runtimeHtml, /worker-src blob:/)
  assert.equal(catalog.errors.length, 0)
  assert.ok(catalog.plugins.some(({ manifest: loaded }) => loaded.id === manifest.id))
})

test('the standard form creates colored Python, JavaScript, and TypeScript Styled Text', async () => {
  const command = await loadCodeCardCommand()
  const cases = [
    {
      language: 'python',
      source: 'def привет(name):\n\treturn f"Привет, 😀 {name}"\n\n',
      normalized: 'def привет(name):\n\treturn f"Привет, 😀 {name}"\n\n',
    },
    {
      language: 'javascript',
      source: 'const привет = "hello 😀";\r\n\r\nconsole.log(привет);',
      normalized: 'const привет = "hello 😀";\n\nconsole.log(привет);',
    },
    {
      language: 'typescript',
      source: 'type User = { name: string }\nconst user: User = { name: "Ada" }',
      normalized: 'type User = { name: string }\nconst user: User = { name: "Ada" }',
    },
  ]

  for (const { language, source, normalized } of cases) {
    const generated = await generate(command, formValues(language, source))
    assert.deepEqual(JSON.parse(JSON.stringify(generated.schema)), {
      title: 'Generate Code Card',
      fields: [
        { id: 'windowTitle', type: 'text', label: 'Window title', defaultValue: 'Code Editor', required: true },
        {
          id: 'language', type: 'select', label: 'Language',
          options: [
            { value: 'python', label: 'Python' },
            { value: 'javascript', label: 'JavaScript' },
            { value: 'typescript', label: 'TypeScript' },
          ],
          defaultValue: 'python', required: true,
        },
        { id: 'sourceCode', type: 'textarea', label: 'Source code' },
      ],
      submitLabel: 'Generate',
    })
    assert.equal(generated.errors.length, 0)
    const codeObject = getCodeObject(generated.addedObjects, normalized)
    assert.ok(codeObject.runs && codeObject.runs.length > 2)
    assertValidRuns(codeObject.text, codeObject.runs)
    assert.doesNotMatch(codeObject.text, /<span|<pre|<code/i)
    assert.equal(codeObject.text, normalized)
    assert.equal(codeObject.color.toUpperCase(), '#D4D4D4')

    const emojiOffset = codeObject.text.indexOf('😀')
    if (emojiOffset >= 0) {
      assert.ok(!codeObject.runs?.some((run) => run.start === emojiOffset + 1 || run.end === emojiOffset + 1))
    }
    const sourceLines = normalized.split('\n')
    const expectedLineNumbers = sourceLines
      .map((_, index) => String(index + 1).padStart(String(sourceLines.length).length, ' '))
      .join('\n')
    const lineNumbers = generated.addedObjects.find((item): item is TextObject => (
      typeof item === 'object' && item !== null && 'type' in item && item.type === 'text' &&
      'text' in item && item.text === expectedLineNumbers
    ))
    assert.ok(lineNumbers)
  }
})

test('invalid languages, cancellation, and unfit source do not stage scene objects', async () => {
  const command = await loadCodeCardCommand()
  const cancelled = await generate(command, { status: 'cancelled' })
  assert.equal(cancelled.addedObjects.length, 0)
  assert.equal(cancelled.snapshotCount, 0)

  const invalid = await generate(command, formValues('ruby', 'puts "hello"'))
  assert.equal(invalid.addedObjects.length, 0)
  assert.equal(invalid.snapshotCount, 0)
  assert.match(invalid.errors[0], /Python, JavaScript, or TypeScript/)

  const tooLong = await generate(command, formValues('python', 'x'.repeat(16_384)))
  assert.equal(tooLong.addedObjects.length, 0)
  assert.match(tooLong.errors[0], /readable size|does not fit/i)
})

test('one generated composition is valid, centered, atomic, undoable, saveable, and renders styled SVG', async () => {
  const command = await loadCodeCardCommand()
  const initial = createSceneDocument(1280, 720)
  let committed = initial
  const transaction = createPluginCommandTransaction(initial, (document) => { committed = document })
  let requestedForm = false
  await command({
    ui: {
      showForm: async () => {
        requestedForm = true
        return formValues('python', 'def hello(name):\n    return "Hello, " + name\n\n', 'Program Manager')
      },
    },
    snapshotDocument: async () => transaction.snapshotDocument(),
    addObjects: async (objects) => transaction.addObjects(structuredClone(objects) as NewSceneObject[]),
    showError: async (message) => assert.fail(message),
  })
  assert.equal(requestedForm, true)

  const generated = transaction.snapshotDocument()
  assert.ok(generated.objects.length >= 20)
  assert.equal(new Set(generated.objects.map(({ id }) => id)).size, generated.objects.length)
  const xValues = generated.objects.map(({ x }) => x)
  const yValues = generated.objects.map(({ y }) => y)
  assert.ok(Math.min(...xValues) >= 0)
  assert.ok(Math.min(...yValues) >= 0)
  const windowBounds = generated.objects.filter((object) => object.type === 'rectangle')
    .find((object) => object.fill === '#C0C0C0' && object.stroke === '#000000' && object.strokeWidth === 2)
  assert.ok(windowBounds)
  assert.ok(windowBounds.x >= 0 && windowBounds.x + windowBounds.width <= initial.artboard.width)
  assert.ok(windowBounds.y >= 0 && windowBounds.y + windowBounds.height <= initial.artboard.height)

  transaction.commit()
  assert.deepEqual(committed, generated)
  const history = new DocumentHistory(initial)
  assert.equal(history.recordChange(initial, generated), true)
  assert.equal(history.undo(generated), initial)
  assert.deepEqual(history.redo(initial), generated)

  const manifestText = serializeProjectManifest(createProjectManifest('code-card', 'Code Card', generated))
  const reopened = openProjectSession(manifestText, '/code-card')
  assert.deepEqual(reopened.document, generated)
  const codeObject = reopened.document.objects.find((object): object is TextObject => (
    object.type === 'text' && object.text.startsWith('def hello')
  ))
  assert.ok(codeObject?.runs?.length)
  const svg = renderSceneSvg(reopened.document)
  assert.match(svg, /Program Manager/)
  for (const run of codeObject.runs ?? []) assert.ok(svg.includes(`fill="${run.color}"`))

  const repeated = await generate(command, formValues('javascript', 'const ready = true;'))
  assert.equal(repeated.addedObjects.length, generated.objects.length)
  assert.ok(repeated.addedObjects.every((object) => (
    typeof object === 'object' && object !== null && !('id' in object)
  )))
})
