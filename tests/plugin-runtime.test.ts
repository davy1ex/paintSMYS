import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPluginCommandTransaction } from '../src/application/plugins/plugin-command-transaction'
import { type LoadedPlugin, type PluginFormPresentation, type PluginHost, type PluginManifest } from '../src/application/plugins/plugin-api'
import { createSceneDocument } from '../src/core/document/scene-document'
import { IsolatedPluginRuntime } from '../src/app/desktop/plugins/isolated-plugin-runtime'

type Message = Record<string, unknown>
type MessageListener = (event: MessageEvent) => void

class FakePluginFrame {
  readonly messages: Message[] = []
  readonly contentWindow = {
    postMessage: (message: Message) => {
      this.messages.push(message)
      if (message.kind === 'initialize') {
        this.parent.send(this.contentWindow, {
          kind: 'ready',
          commandIds: ['make-shapes'],
        })
      }
    },
  }
  readonly style: Record<string, string> = {}
  title = ''
  tabIndex = 0
  referrerPolicy = ''
  src = ''
  removed = false
  private readonly listeners = new Map<string, Set<() => void>>()

  constructor(private readonly parent: FakeBrowserWindow) {}

  setAttribute(_name: string, _value: string): void {}

  addEventListener(name: string, listener: () => void): void {
    const listeners = this.listeners.get(name) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  dispatch(name: string): void {
    for (const listener of this.listeners.get(name) ?? []) listener()
  }

  send(message: Message): void {
    this.parent.send(this.contentWindow, message)
  }

  remove(): void {
    this.removed = true
  }
}

class FakeBrowserWindow {
  readonly location = { href: 'file:///paintsmys/index.html' }
  readonly frames: FakePluginFrame[] = []
  private readonly listeners = new Set<MessageListener>()

  addEventListener(name: string, listener: MessageListener): void {
    if (name === 'message') this.listeners.add(listener)
  }

  removeEventListener(name: string, listener: MessageListener): void {
    if (name === 'message') this.listeners.delete(listener)
  }

  setTimeout(callback: () => void, timeout: number): number {
    return globalThis.setTimeout(callback, timeout) as unknown as number
  }

  clearTimeout(id: number): void {
    globalThis.clearTimeout(id)
  }

  createFrame(): FakePluginFrame {
    const frame = new FakePluginFrame(this)
    this.frames.push(frame)
    return frame
  }

  send(source: object, data: Message): void {
    const event = { source, data, origin: 'null' } as MessageEvent
    for (const listener of this.listeners) listener(event)
  }
}

const manifest: PluginManifest = {
  id: 'com.paintsmys.test.bridge',
  name: 'Bridge Test',
  version: '1.0.0',
  apiVersion: 0,
  entry: 'index.js',
  commands: [{ id: 'make-shapes', name: 'Make Shapes' }],
}
const plugin: LoadedPlugin = { manifest, source: '/* simulated in the sandbox test harness */' }
const formSchema = {
  title: 'Generate',
  fields: [{ id: 'label', type: 'text', label: 'Label', defaultValue: 'Window', required: true }],
  submitLabel: 'Generate',
}

function rectangle() {
  return { type: 'rectangle', x: 1, y: 2, width: 30, height: 20, fill: '#c0c0c0', stroke: '#000000', strokeWidth: 1 }
}

function setup(timeouts = { load: 500, command: 1000, form: 500 }) {
  const browser = new FakeBrowserWindow()
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser })
  const fakeDocument = {
    createElement: () => browser.createFrame() as unknown as HTMLIFrameElement,
    body: { appendChild: (frame: HTMLIFrameElement) => (frame as unknown as FakePluginFrame).dispatch('load') },
  } as unknown as Document
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })

  let sessionGeneration = 7
  let committedDocument = createSceneDocument(800, 600)
  let commitCount = 0
  const forms: PluginFormPresentation[] = []
  const dismissed: string[] = []
  const host: PluginHost = {
    beginCommand: (sessionToken) => {
      if (sessionToken !== sessionGeneration) throw new Error('No active project.')
      return createPluginCommandTransaction(committedDocument, (nextDocument) => {
        committedDocument = nextDocument
        commitCount += 1
      })
    },
    showError: () => undefined,
    isSessionCurrent: (sessionToken) => sessionToken === sessionGeneration,
    presentForm: (form) => { forms.push(form) },
    dismissForm: (requestId) => { dismissed.push(requestId) },
  }
  const runtime = new IsolatedPluginRuntime(async () => ({ plugins: [plugin], errors: [] }), host, timeouts)
  const restore = () => {
    runtime.dispose()
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
  return {
    browser,
    runtime,
    forms,
    dismissed,
    get committedDocument() { return committedDocument },
    get commitCount() { return commitCount },
    setSessionGeneration(value: number) { sessionGeneration = value },
    async load() { await runtime.load(); return browser.frames[0] },
    restore,
  }
}

function latest(frame: FakePluginFrame, kind: string, method?: string): Message {
  const message = [...frame.messages].reverse().find((item) => item.kind === kind && (method === undefined || item.method === method))
  assert.ok(message, `expected a ${kind}${method ? ` (${method})` : ''} message`)
  return message
}

function sendFormRequest(frame: FakePluginFrame, invocationId: string, requestId: string): void {
  frame.send({ kind: 'request', invocationId, requestId, method: 'show-form', args: [formSchema] })
}

test('the iframe bridge correlates showForm and submits a single atomic plugin transaction', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'request-1')
    assert.equal(context.forms.length, 1)
    assert.equal(context.forms[0].invocationId, invocationId)
    assert.equal(context.forms[0].requestId, 'request-1')
    assert.deepEqual(context.forms[0].schema, formSchema)

    context.runtime.submitForm('request-1', { label: 'My Window' })
    const response = latest(frame, 'response')
    assert.equal(response.requestId, 'request-1')
    assert.deepEqual(response.value, { status: 'submitted', values: { label: 'My Window' } })
    assert.deepEqual(context.dismissed, ['request-1'])

    frame.send({ kind: 'request', invocationId, requestId: 'request-2', method: 'add-objects', args: [[rectangle()]] })
    assert.equal(latest(frame, 'response').requestId, 'request-2')
    frame.send({ kind: 'finished', invocationId, success: true })
    await command
    assert.equal(context.commitCount, 1)
    assert.equal(context.committedDocument.objects.length, 1)
  } finally {
    context.restore()
  }
})

test('existing action commands continue to use the bridge without requesting a form', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    frame.send({ kind: 'request', invocationId, requestId: 'legacy-add', method: 'add-objects', args: [[rectangle()]] })
    assert.equal(latest(frame, 'response').success, true)
    frame.send({ kind: 'finished', invocationId, success: true })
    await command
    assert.equal(context.commitCount, 1)
    assert.equal(context.committedDocument.objects.length, 1)
    assert.equal(context.forms.length, 0)
  } finally {
    context.restore()
  }
})

test('Cancel resolves showForm as cancelled, rolls back staged objects, and rejects later requests', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    frame.send({ kind: 'request', invocationId, requestId: 'add-before', method: 'add-objects', args: [[rectangle()]] })
    sendFormRequest(frame, invocationId, 'cancel-me')

    context.runtime.cancelForm('cancel-me')
    await command
    assert.deepEqual(latest(frame, 'response').value, { status: 'cancelled' })
    assert.equal(context.commitCount, 0)
    assert.equal(context.committedDocument.objects.length, 0)
    assert.deepEqual(context.dismissed, ['cancel-me'])

    context.runtime.submitForm('cancel-me', { label: 'Late result' })
    frame.send({ kind: 'request', invocationId, requestId: 'late-add', method: 'add-objects', args: [[rectangle()]] })
    assert.equal(latest(frame, 'response').success, false)
    frame.send({ kind: 'finished', invocationId, success: true })
    assert.equal(context.commitCount, 0)
  } finally {
    context.restore()
  }
})

test('the runtime dismisses a pending form before an application close handshake proceeds', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'close-form')
    context.runtime.cancelPendingForm()
    const events = [...context.dismissed, 'close-handshake']
    await command
    assert.deepEqual(events, ['close-form', 'close-handshake'])
  } finally {
    context.restore()
  }
})

test('a plugin failure after Submit rolls back objects staged by the invocation', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'submit-then-fail')
    context.runtime.submitForm('submit-then-fail', { label: 'Submitted' })
    frame.send({ kind: 'request', invocationId, requestId: 'stage-after-submit', method: 'add-objects', args: [[rectangle()]] })
    frame.send({ kind: 'finished', invocationId, success: false, message: 'Failure after the form.' })
    await assert.rejects(command, /Failure after the form/)
    assert.equal(context.commitCount, 0)
    assert.equal(context.committedDocument.objects.length, 0)
  } finally {
    context.restore()
  }
})

test('the runtime rejects a second form while one is pending and ignores repeated Submit', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'first-form')
    sendFormRequest(frame, invocationId, 'second-form')
    assert.equal(context.forms.length, 1)
    assert.equal(latest(frame, 'response').requestId, 'second-form')
    assert.match(String(latest(frame, 'response').message), /already open/)

    context.runtime.submitForm('first-form', { label: 'Once' })
    const responseCount = frame.messages.filter((message) => message.kind === 'response' && message.requestId === 'first-form').length
    context.runtime.submitForm('first-form', { label: 'Twice' })
    assert.equal(frame.messages.filter((message) => message.kind === 'response' && message.requestId === 'first-form').length, responseCount)
    frame.send({ kind: 'finished', invocationId, success: true })
    await command
    assert.equal(context.commitCount, 0)
  } finally {
    context.restore()
  }
})

test('a reused request ID cannot confuse a pending form response', async () => {
  const context = setup()
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'reused-id')
    frame.send({ kind: 'request', invocationId, requestId: 'reused-id', method: 'snapshot-document', args: [] })
    await assert.rejects(command, /reused a request ID/)
    assert.deepEqual(context.dismissed, ['reused-id'])
    assert.equal(context.commitCount, 0)
    assert.equal(latest(frame, 'response').requestId, 'reused-id')
    assert.equal(latest(frame, 'response').success, false)
  } finally {
    context.restore()
  }
})

test('a form timeout fails the invocation, closes the form, and rolls back', async () => {
  const context = setup({ load: 500, command: 500, form: 10 })
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'timeout-form')
    await assert.rejects(command, /timed out after 5 minutes/)
    assert.deepEqual(context.dismissed, ['timeout-form'])
    assert.equal(context.commitCount, 0)
    assert.equal(latest(frame, 'response').success, false)
  } finally {
    context.restore()
  }
})

test('time spent waiting for form input is excluded from the command execution timeout', async () => {
  const context = setup({ load: 500, command: 100, form: 500 })
  try {
    const frame = await context.load()
    const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
    const invocationId = String(latest(frame, 'invoke').invocationId)
    sendFormRequest(frame, invocationId, 'long-wait')
    await new Promise((resolve) => globalThis.setTimeout(resolve, 150))
    context.runtime.submitForm('long-wait', { label: 'Finished later' })
    frame.send({ kind: 'finished', invocationId, success: true })
    await command
    assert.equal(context.commitCount, 0)
  } finally {
    context.restore()
  }
})

test('plugin errors, session changes, and iframe destruction clean up the pending form', async (t) => {
  await t.test('plugin error', async () => {
    const context = setup()
    try {
      const frame = await context.load()
      const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
      const invocationId = String(latest(frame, 'invoke').invocationId)
      sendFormRequest(frame, invocationId, 'plugin-error')
      frame.send({ kind: 'finished', invocationId, success: false, message: 'Plugin exploded.' })
      await assert.rejects(command, /Plugin exploded/)
      assert.deepEqual(context.dismissed, ['plugin-error'])
      assert.equal(context.commitCount, 0)
    } finally {
      context.restore()
    }
  })

  await t.test('session change', async () => {
    const context = setup()
    try {
      const frame = await context.load()
      const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
      const invocationId = String(latest(frame, 'invoke').invocationId)
      sendFormRequest(frame, invocationId, 'stale-session')
      context.setSessionGeneration(8)
      context.runtime.submitForm('stale-session', { label: 'Wrong project' })
      await assert.rejects(command, /project changed/)
      assert.deepEqual(context.dismissed, ['stale-session'])
      assert.equal(context.commitCount, 0)
    } finally {
      context.restore()
    }
  })

  await t.test('iframe destruction', async () => {
    const context = setup()
    try {
      const frame = await context.load()
      const command = context.runtime.invoke(manifest.id, 'make-shapes', 7)
      const invocationId = String(latest(frame, 'invoke').invocationId)
      sendFormRequest(frame, invocationId, 'destroyed-frame')
      context.runtime.dispose()
      await assert.rejects(command, /runtime was closed/)
      assert.equal(frame.removed, true)
      assert.deepEqual(context.dismissed, ['destroyed-frame'])
    } finally {
      context.restore()
    }
  })
})
