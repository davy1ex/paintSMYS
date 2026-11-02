import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DocumentHistory } from '../src/application/document-history'
import { createPluginCommandTransaction } from '../src/application/plugins/plugin-command-transaction'
import {
  parsePluginManifest,
  parsePluginManifestText,
  getPluginMenuEmptyMessage,
  createPluginFormDefaults,
  MAX_PLUGIN_FORM_FIELDS,
  MAX_PLUGIN_FORM_OPTIONS,
  MAX_PLUGIN_FORM_RESPONSE_BYTES,
  MAX_PLUGIN_FORM_SCHEMA_BYTES,
  MAX_PLUGIN_FORM_TEXTAREA_LENGTH,
  MAX_PLUGIN_FORM_TEXT_LENGTH,
  validatePluginFormSchema,
  validatePluginFormValues,
  validateRegisteredPluginCommands,
  type PluginManifest,
} from '../src/application/plugins/plugin-api'
import { createUntitledProjectSession, openProjectSession, updateProjectSessionDocument } from '../src/application/project-session'
import { saveProjectSession } from '../src/application/save-project-session'
import { loadInstalledPlugins } from '../src/app/desktop/plugin-loader'
import { addRectangle, appendSceneObjects, createSceneDocument } from '../src/core/document/scene-document'

const validManifest: PluginManifest = {
  id: 'com.paintsmys.test.example',
  name: 'Test Plugin',
  version: '1.0.0',
  apiVersion: 0,
  entry: 'index.js',
  commands: [{ id: 'make-shapes', name: 'Make Shapes' }],
}

const validFormSchema = {
  title: 'Generate Window',
  fields: [
    { id: 'title', type: 'text', label: 'Title', defaultValue: 'Program Manager', required: true },
    { id: 'message', type: 'textarea', label: 'Message', defaultValue: 'Welcome' },
    { id: 'style', type: 'select', label: 'Style', options: [{ value: 'classic', label: 'Classic' }, { value: 'dark', label: 'Dark' }], defaultValue: 'classic' },
  ],
  submitLabel: 'Generate',
} as const

function rectangle(x = 10) {
  return { type: 'rectangle', x, y: 20, width: 80, height: 40, fill: '#c0c0c0', stroke: '#000000', strokeWidth: 1 }
}

test('plugin manifests validate required fields, API compatibility, and entry point paths', () => {
  assert.deepEqual(parsePluginManifest(validManifest), validManifest)
  assert.throws(() => parsePluginManifest({ ...validManifest, apiVersion: 1 }), /version .* not supported/)
  assert.throws(() => parsePluginManifest({ ...validManifest, entry: '../outside.js' }), /entry point is invalid/)
  assert.throws(() => parsePluginManifest({ ...validManifest, commands: [{ id: 'make-shapes', name: 'A' }, { id: 'make-shapes', name: 'B' }] }), /duplicate ID/)
  assert.throws(() => parsePluginManifestText('{broken json'), /not valid JSON/)
})

test('plugin command registration must exactly match declared commands', () => {
  assert.deepEqual(validateRegisteredPluginCommands(validManifest.commands, ['make-shapes']), validManifest.commands)
  assert.throws(() => validateRegisteredPluginCommands(validManifest.commands, []), /every declared command/)
  assert.throws(() => validateRegisteredPluginCommands(validManifest.commands, ['make-shapes', 'make-shapes']), /every declared command/)
  assert.throws(() => validateRegisteredPluginCommands(validManifest.commands, ['unknown']), /every declared command/)
  assert.throws(() => validateRegisteredPluginCommands(validManifest.commands, [3]), /invalid command list/)
})

test('the Plugins menu has a clear empty state with and without plugin load errors', () => {
  assert.equal(getPluginMenuEmptyMessage(0, 0), 'No plugins installed')
  assert.equal(getPluginMenuEmptyMessage(0, 1), 'No plugin commands available')
  assert.equal(getPluginMenuEmptyMessage(1, 0), null)
})

test('plugin form schemas validate and produce string defaults for all supported field types', () => {
  const schema = validatePluginFormSchema(validFormSchema)
  assert.deepEqual(schema, validFormSchema)
  assert.deepEqual(createPluginFormDefaults(schema), { title: 'Program Manager', message: 'Welcome', style: 'classic' })
  assert.deepEqual(validatePluginFormValues(schema, { title: 'Desktop', message: '', style: 'dark' }), {
    title: 'Desktop', message: '', style: 'dark',
  })
})

test('plugin form schemas reject unknown types, properties, and duplicate field IDs', () => {
  assert.throws(() => validatePluginFormSchema({ ...validFormSchema, fields: [{ id: 'x', type: 'date', label: 'Date' }] }), /unsupported field type/)
  assert.throws(() => validatePluginFormSchema({ ...validFormSchema, custom: true }), /only title, fields, and submitLabel/)
  assert.throws(() => validatePluginFormSchema({ ...validFormSchema, fields: [validFormSchema.fields[0], { ...validFormSchema.fields[0] }] }), /duplicated/)
  assert.throws(() => validatePluginFormSchema({ ...validFormSchema, fields: [{ ...validFormSchema.fields[0], html: '<b>Title</b>' }] }), /unknown property/)
})

test('plugin select fields reject duplicate options and defaults outside the static option list', () => {
  const select = { id: 'style', type: 'select', label: 'Style', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'Again' }] }
  assert.throws(() => validatePluginFormSchema({ title: 'Style', fields: [select] }), /unique values/)
  assert.throws(() => validatePluginFormSchema({ title: 'Style', fields: [{ ...select, options: [{ value: 'a', label: 'A' }], defaultValue: 'b' }] }), /match one of its options/)
  assert.throws(() => validatePluginFormSchema({ title: 'Style', fields: [{ ...select, options: [{ value: 'a', label: '' }] }]}), /option 1 is invalid/)
})

test('plugin form schema and field limits are enforced', () => {
  assert.throws(() => validatePluginFormSchema({ title: 'Too many', fields: Array.from({ length: MAX_PLUGIN_FORM_FIELDS + 1 }, (_, index) => ({ id: `f${index}`, type: 'text', label: `Field ${index}` })) }), /between 1 and/)
  assert.throws(() => validatePluginFormSchema({ title: 'Too many options', fields: [{ id: 's', type: 'select', label: 'Select', options: Array.from({ length: MAX_PLUGIN_FORM_OPTIONS + 1 }, (_, index) => ({ value: String(index), label: String(index) })) }] }), /between 1 and/)
  assert.throws(() => validatePluginFormSchema({ title: 'Large', fields: [{ id: 'text', type: 'text', label: 'Text', defaultValue: 'x'.repeat(MAX_PLUGIN_FORM_TEXT_LENGTH + 1) }] }), /invalid defaultValue/)
  assert.throws(() => validatePluginFormSchema({ title: 'Large', fields: [{ id: 'area', type: 'textarea', label: 'Text', defaultValue: 'x'.repeat(MAX_PLUGIN_FORM_TEXTAREA_LENGTH + 1) }] }), /invalid defaultValue/)
  assert.throws(() => validatePluginFormSchema({ title: 'Large', fields: [{ id: 'area', type: 'textarea', label: 'Text', defaultValue: 'x'.repeat(MAX_PLUGIN_FORM_SCHEMA_BYTES) }] }), /schema exceeds/)
})

test('plugin form submissions enforce required values, types, lengths, options, and the response byte limit', () => {
  const schema = validatePluginFormSchema(validFormSchema)
  assert.throws(() => validatePluginFormValues(schema, { title: '  ', message: '', style: 'classic' }), /is required/)
  assert.throws(() => validatePluginFormValues(schema, { title: 4, message: '', style: 'classic' }), /invalid or too long/)
  assert.throws(() => validatePluginFormValues(schema, { title: 'Title', message: '', style: 'other' }), /not one of its options/)
  assert.throws(() => validatePluginFormValues(schema, { title: 'Title', message: '', style: 'classic', extra: '' }), /do not match/)
  assert.throws(() => validatePluginFormValues(schema, { title: 'x'.repeat(MAX_PLUGIN_FORM_TEXT_LENGTH + 1), message: '', style: 'classic' }), /invalid or too long/)

  const responseSchema = validatePluginFormSchema({
    title: 'Large response',
    fields: [1, 2, 3].map((index) => ({ id: `area${index}`, type: 'textarea', label: `Area ${index}` })),
  })
  const largeValues = Object.fromEntries(responseSchema.fields.map(({ id }) => [id, 'x'.repeat(MAX_PLUGIN_FORM_RESPONSE_BYTES / 3 + 32)]))
  assert.throws(() => validatePluginFormValues(responseSchema, largeValues), /response exceeds/)
})

test('plugin batches receive unique IDs and invalid batches leave the staged document unchanged', () => {
  const initial = addRectangle(createSceneDocument(800, 600), { x: 1, y: 2, width: 10, height: 12 })
  const appended = appendSceneObjects(initial, [rectangle(), {
    type: 'text', x: 20, y: 30, text: 'Win95', fontFamily: 'Arial', fontSize: 16, color: '#000080',
  }])
  assert.equal(appended.objects.length, 3)
  assert.equal(new Set(appended.objects.map(({ id }) => id)).size, 3)

  const transaction = createPluginCommandTransaction(initial, () => assert.fail('A staged batch should not be committed by addObjects.'))
  transaction.addObjects([rectangle()])
  const beforeInvalidBatch = transaction.snapshotDocument()
  assert.throws(() => transaction.addObjects([
    rectangle(120),
    { type: 'text', x: 0, y: 0, text: 'Invalid', fontFamily: 'Arial', fontSize: 0, color: '#000000' },
  ]), /font size/)
  assert.deepEqual(transaction.snapshotDocument(), beforeInvalidBatch)
  transaction.rollback()
})

test('one successful plugin command is one undo/redo action and survives Save/Open', async () => {
  const session = createUntitledProjectSession(800, 600)
  const history = new DocumentHistory()
  let committed = session.document
  const transaction = createPluginCommandTransaction(session.document, (document) => { committed = document })
  transaction.addObjects([rectangle(), rectangle(120), {
    type: 'text', x: 10, y: 90, text: 'Windows 95', fontFamily: 'Arial', fontSize: 18, color: '#000080',
  }])
  transaction.commit()

  assert.equal(committed.objects.length, 3)
  assert.equal(history.recordChange(session.document, committed), true)
  assert.equal(history.undo(committed), session.document)
  assert.equal(history.canUndo, false)
  const redone = history.redo(session.document)
  assert.deepEqual(redone, committed)
  assert.equal(history.canRedo, false)

  let manifestText = ''
  const saveResult = await saveProjectSession(updateProjectSessionDocument(session, committed), {
    saveProject: async ({ manifestText: serialized }) => {
      manifestText = serialized
      return { status: 'saved', projectRoot: '/projects/win95', projectName: 'Win95' }
    },
  })
  assert.equal(saveResult.status, 'saved')
  const reopened = openProjectSession(manifestText, '/projects/win95')
  assert.deepEqual(reopened.document.objects, committed.objects)
})

test('a session switch before plugin commit leaves the newly active session untouched', () => {
  const firstSession = createUntitledProjectSession(800, 600)
  const secondDocument = createSceneDocument(300, 200)
  let activeToken = 1
  let activeDocument = firstSession.document
  const transaction = createPluginCommandTransaction(firstSession.document, (document) => {
    if (activeToken !== 1 || activeDocument !== firstSession.document) {
      throw new Error('The active project changed while the plugin command was running.')
    }
    activeDocument = document
  })
  transaction.addObjects([rectangle()])

  activeToken = 2
  activeDocument = secondDocument
  assert.throws(() => transaction.commit(), /active project changed/)
  assert.equal(activeDocument, secondDocument)
})

test('a plugin command error can roll back staged objects without publishing a change', () => {
  const initial = createSceneDocument(800, 600)
  let committed = 0
  const transaction = createPluginCommandTransaction(initial, () => { committed += 1 })
  transaction.addObjects([rectangle()])
  transaction.rollback()

  assert.equal(committed, 0)
  assert.equal(initial.objects.length, 0)
  assert.throws(() => transaction.snapshotDocument(), /already finished/)
})

test('installed plugin folders load their external manifest and source without evaluation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paint-smys-plugins-'))
  try {
    const packagePath = join(root, 'valid-plugin')
    await mkdir(packagePath)
    await writeFile(join(packagePath, 'manifest.json'), JSON.stringify(validManifest))
    await writeFile(join(packagePath, 'index.js'), 'globalThis.paintSMYSPlugin = { activate() {} }')
    const invalidPath = join(root, 'invalid-plugin')
    await mkdir(invalidPath)
    await writeFile(join(invalidPath, 'manifest.json'), JSON.stringify({ ...validManifest, apiVersion: 100 }))
    await writeFile(join(invalidPath, 'index.js'), 'throw new Error("must not run")')

    const catalog = await loadInstalledPlugins(root)
    assert.equal(catalog.plugins.length, 1)
    assert.equal(catalog.plugins[0].manifest.id, validManifest.id)
    assert.match(catalog.plugins[0].source, /paintSMYSPlugin/)
    assert.equal(catalog.errors.length, 1)
    assert.match(catalog.errors[0], /not supported/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
