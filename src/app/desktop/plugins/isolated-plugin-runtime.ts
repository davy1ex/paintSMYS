import {
  MAX_PLUGIN_SOURCE_BYTES,
  parsePluginManifest,
  validatePluginFormSchema,
  validatePluginFormValues,
  validateRegisteredPluginCommands,
  type LoadedPlugin,
  type PluginCatalog,
  type PluginCommandManifest,
  type PluginFormPresentation,
  type PluginFormResult,
  type PluginFormSchema,
  type PluginHost,
  type PluginMenuCommand,
  type PluginRuntime,
} from '../../../application/plugins/plugin-api'

export const PLUGIN_LOAD_TIMEOUT_MS = 8_000
export const PLUGIN_COMMAND_TIMEOUT_MS = 60_000
export const PLUGIN_FORM_TIMEOUT_MS = 5 * 60_000

type RuntimeTimeouts = { load: number; command: number; form: number }

type ActiveInvocation = {
  id: string
  transaction: ReturnType<PluginHost['beginCommand']>
  resolve: () => void
  reject: (error: Error) => void
  sessionGeneration: number
  timeoutId: number | null
  timeoutStartedAt: number | null
  remainingExecutionMs: number
  cancelled: boolean
  requestIds: Set<string>
}

type PendingForm = {
  requestId: string
  invocationId: string
  sessionGeneration: number
  schema: PluginFormSchema
  frame: PluginFrame
  timeoutId: number
}

type PluginFrame = {
  plugin: LoadedPlugin
  frame: HTMLIFrameElement
  active: ActiveInvocation | null
  commands: Map<string, PluginCommandManifest>
  loadTimer: number
  finishLoad: (result: { commands: PluginCommandManifest[]; error?: string }) => void
  removeListener: () => void
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('The plugin command failed.')
}

function keyFor(pluginId: string, commandId: string): string {
  return `${pluginId}/${commandId}`
}

function submittedResult(values: Record<string, string>): PluginFormResult {
  return { status: 'submitted', values }
}

export class IsolatedPluginRuntime implements PluginRuntime {
  private readonly frames = new Map<string, PluginFrame>()
  private readonly pendingFrames = new Set<PluginFrame>()
  private readonly commandFrames = new Map<string, PluginFrame>()
  private nextInvocationId = 0
  private disposed = false
  private pendingForm: PendingForm | null = null

  constructor(
    private readonly getCatalog: () => Promise<PluginCatalog>,
    private readonly host: PluginHost,
    private readonly timeouts: RuntimeTimeouts = {
      load: PLUGIN_LOAD_TIMEOUT_MS,
      command: PLUGIN_COMMAND_TIMEOUT_MS,
      form: PLUGIN_FORM_TIMEOUT_MS,
    },
  ) {}

  async load() {
    const errors: string[] = []
    let catalog: PluginCatalog
    try {
      catalog = await this.getCatalog()
    } catch (error) {
      return { commands: [], errors: [toError(error).message] }
    }
    if (this.disposed) return { commands: [], errors: [] }
    errors.push(...catalog.errors)

    const seenPluginIds = new Set<string>()
    const loaded = await Promise.all(catalog.plugins.map(async (plugin) => {
      try {
        const manifest = parsePluginManifest(plugin.manifest)
        if (seenPluginIds.has(manifest.id)) throw new Error(`Plugin ID "${manifest.id}" is duplicated.`)
        seenPluginIds.add(manifest.id)
        if (typeof plugin.source !== 'string' || new TextEncoder().encode(plugin.source).byteLength > MAX_PLUGIN_SOURCE_BYTES) {
          throw new Error('The plugin entry point is invalid or too large.')
        }
        return await this.loadPlugin({ manifest, source: plugin.source })
      } catch (error) {
        return { pluginName: plugin.manifest?.name ?? 'Plugin', commands: [], error: toError(error).message }
      }
    }))

    const commands: PluginMenuCommand[] = []
    for (const result of loaded) {
      if (result.error) errors.push(`${result.pluginName}: ${result.error}`)
      for (const command of result.commands) {
        const frame = this.frames.get(result.pluginId ?? '')
        if (!frame) continue
        this.commandFrames.set(keyFor(frame.plugin.manifest.id, command.id), frame)
        commands.push({ ...command, pluginId: frame.plugin.manifest.id, pluginName: frame.plugin.manifest.name })
      }
    }
    return { commands, errors }
  }

  invoke(pluginId: string, commandId: string, sessionToken: number): Promise<void> {
    const frame = this.commandFrames.get(keyFor(pluginId, commandId))
    if (this.disposed || !frame || frame.active) return Promise.reject(new Error('This plugin command is unavailable or already running.'))

    let transaction: ReturnType<PluginHost['beginCommand']>
    try {
      transaction = this.host.beginCommand(sessionToken)
    } catch (error) {
      return Promise.reject(toError(error))
    }

    const invocationId = `paint-smys-${++this.nextInvocationId}`
    return new Promise<void>((resolve, reject) => {
      const active: ActiveInvocation = {
        id: invocationId,
        transaction,
        resolve,
        reject,
        sessionGeneration: sessionToken,
        timeoutId: null,
        timeoutStartedAt: null,
        remainingExecutionMs: this.timeouts.command,
        cancelled: false,
        requestIds: new Set(),
      }
      frame.active = active
      this.resumeExecutionTimeout(active, frame)
      frame.frame.contentWindow?.postMessage({ kind: 'invoke', commandId, invocationId }, '*')
    })
  }

  submitForm(requestId: string, values: unknown): void {
    const pending = this.pendingForm
    if (!pending || pending.requestId !== requestId) return
    const active = pending.frame.active
    if (!active || active.id !== pending.invocationId || active.cancelled) {
      this.abortPendingForm(pending, new Error('The plugin form is no longer active.'))
      return
    }
    if (!this.host.isSessionCurrent(pending.sessionGeneration)) {
      this.abortPendingForm(pending, new Error('The project changed while the plugin form was open.'))
      return
    }

    const validatedValues = validatePluginFormValues(pending.schema, values)
    this.clearPendingForm(pending)
    pending.frame.frame.contentWindow?.postMessage({
      kind: 'response',
      requestId: pending.requestId,
      success: true,
      value: submittedResult(validatedValues),
      message: '',
    }, '*')
    this.resumeExecutionTimeout(active, pending.frame)
  }

  cancelForm(requestId: string): void {
    const pending = this.pendingForm
    if (pending?.requestId === requestId) this.cancelPendingForm()
  }

  cancelPendingForm(): void {
    const pending = this.pendingForm
    if (!pending) return
    const active = pending.frame.active
    this.clearPendingForm(pending)
    pending.frame.frame.contentWindow?.postMessage({
      kind: 'response',
      requestId: pending.requestId,
      success: true,
      value: { status: 'cancelled' },
      message: '',
    }, '*')
    if (!active || active.id !== pending.invocationId) return
    active.cancelled = true
    active.transaction.rollback()
    this.finishInvocation(pending.frame, pending.invocationId, null, false)
  }

  dispose(): void {
    this.disposed = true
    if (this.pendingForm) this.abortPendingForm(this.pendingForm, new Error('The plugin runtime was closed.'))
    for (const frame of this.pendingFrames) {
      frame.finishLoad({ commands: [], error: 'The plugin runtime was closed.' })
    }
    for (const frame of this.frames.values()) {
      if (frame.active) this.finishInvocation(frame, frame.active.id, new Error('The plugin runtime was closed.'), false)
      window.clearTimeout(frame.loadTimer)
      frame.removeListener()
      frame.frame.remove()
    }
    this.frames.clear()
    this.commandFrames.clear()
  }

  private loadPlugin(plugin: LoadedPlugin): Promise<{ pluginId?: string; pluginName: string; commands: PluginCommandManifest[]; error?: string }> {
    return new Promise((resolve) => {
      const frame = document.createElement('iframe')
      frame.title = `${plugin.manifest.name} plugin runtime`
      frame.setAttribute('sandbox', 'allow-scripts')
      frame.setAttribute('aria-hidden', 'true')
      frame.tabIndex = -1
      frame.referrerPolicy = 'no-referrer'
      frame.style.display = 'none'

      let settled = false
      let pluginFrame: PluginFrame
      const finishLoad = (result: { commands: PluginCommandManifest[]; error?: string }) => {
        if (settled) return
        settled = true
        window.clearTimeout(pluginFrame.loadTimer)
        this.pendingFrames.delete(pluginFrame)
        if (this.disposed) result = { commands: [], error: 'The plugin runtime was closed.' }
        if (result.error) {
          pluginFrame.removeListener()
          frame.remove()
          resolve({ pluginName: plugin.manifest.name, commands: [], error: result.error })
          return
        }
        pluginFrame.commands = new Map(result.commands.map((command) => [command.id, command]))
        this.frames.set(plugin.manifest.id, pluginFrame)
        resolve({ pluginId: plugin.manifest.id, pluginName: plugin.manifest.name, commands: result.commands })
      }

      const onMessage = (event: MessageEvent) => {
        if (event.source !== frame.contentWindow || event.origin !== 'null') return
        const data = event.data
        if (!data || typeof data !== 'object') return

        if (data.kind === 'ready' && !settled) {
          try {
            finishLoad({ commands: validateRegisteredPluginCommands(plugin.manifest.commands, data.commandIds) })
          } catch (error) {
            finishLoad({ commands: [], error: toError(error).message })
          }
          return
        }
        if ((data.kind === 'load-error' || data.kind === 'runtime-error') && typeof data.message === 'string') {
          const error = new Error(data.message.slice(0, 500))
          if (!settled) finishLoad({ commands: [], error: error.message })
          else if (pluginFrame.active) this.finishInvocation(pluginFrame, pluginFrame.active.id, error, false)
          else if (data.kind === 'runtime-error') this.host.showError(`${plugin.manifest.name}: ${error.message}`)
          return
        }
        if (data.kind === 'request') {
          void this.handleRequest(pluginFrame, data)
          return
        }
        if (data.kind === 'finished' && typeof data.invocationId === 'string') {
          if (data.success === true) this.finishInvocation(pluginFrame, data.invocationId, null, true)
          else this.finishInvocation(pluginFrame, data.invocationId, new Error(typeof data.message === 'string' ? data.message.slice(0, 500) : 'The plugin command failed.'), false)
        }
      }

      pluginFrame = {
        plugin,
        frame,
        active: null,
        commands: new Map(),
        loadTimer: 0,
        finishLoad,
        removeListener: () => window.removeEventListener('message', onMessage),
      }
      this.pendingFrames.add(pluginFrame)
      window.addEventListener('message', onMessage)
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage({
          kind: 'initialize',
          source: plugin.source,
          commandIds: plugin.manifest.commands.map(({ id }) => id),
          capabilities: ['ui.showForm'],
        }, '*')
      }, { once: true })
      pluginFrame.loadTimer = window.setTimeout(() => {
        finishLoad({ commands: [], error: 'The plugin did not finish loading in time.' })
      }, this.timeouts.load)
      frame.src = new URL('plugin-runtime.html', window.location.href).toString()
      document.body.appendChild(frame)
    })
  }

  private async handleRequest(pluginFrame: PluginFrame, data: Record<string, unknown>): Promise<void> {
    const active = pluginFrame.active
    const requestId = typeof data.requestId === 'string' && data.requestId.length <= 160 ? data.requestId : null
    const invocationId = typeof data.invocationId === 'string' ? data.invocationId : null
    if (active && !active.cancelled && requestId && invocationId === active.id) {
      if (active.requestIds.has(requestId)) {
        const error = new Error('The plugin reused a request ID. Each request must have a unique ID.')
        const pending = this.pendingForm
        if (pending?.frame === pluginFrame && pending.invocationId === active.id) {
          this.abortPendingForm(pending, error)
        } else {
          pluginFrame.frame.contentWindow?.postMessage({
            kind: 'response', requestId, success: false, value: undefined, message: error.message,
          }, '*')
          this.finishInvocation(pluginFrame, active.id, error, false)
        }
        return
      }
      active.requestIds.add(requestId)
    }
    let success = false
    let value: unknown
    let message = 'The plugin request is invalid.'

    try {
      if (!active || active.cancelled || !requestId || !invocationId || active.id !== invocationId || !Array.isArray(data.args)) {
        throw new Error('The plugin command is no longer active.')
      }
      if (!this.host.isSessionCurrent(active.sessionGeneration)) {
        throw new Error('The project changed while the plugin command was running.')
      }
      if (data.method === 'snapshot-document' && data.args.length === 0) {
        value = active.transaction.snapshotDocument()
      } else if (data.method === 'add-objects' && data.args.length === 1) {
        active.transaction.addObjects(data.args[0])
      } else if (data.method === 'show-error' && data.args.length === 1 && typeof data.args[0] === 'string') {
        this.host.showError(data.args[0].slice(0, 500))
      } else if (data.method === 'show-form' && data.args.length === 1) {
        if (this.pendingForm) throw new Error('Another plugin form is already open. Close it before opening another form.')
        const schema = validatePluginFormSchema(data.args[0])
        this.openForm(pluginFrame, active, requestId, schema)
        return
      } else {
        throw new Error('The plugin request is not supported.')
      }
      success = true
      message = ''
    } catch (error) {
      message = toError(error).message.slice(0, 500)
    }

    pluginFrame.frame.contentWindow?.postMessage({ kind: 'response', requestId, success, value, message }, '*')
  }

  private openForm(frame: PluginFrame, active: ActiveInvocation, requestId: string, schema: PluginFormSchema): void {
    this.pauseExecutionTimeout(active)
    const pending: PendingForm = {
      requestId,
      invocationId: active.id,
      sessionGeneration: active.sessionGeneration,
      schema,
      frame,
      timeoutId: 0,
    }
    pending.timeoutId = window.setTimeout(() => {
      this.abortPendingForm(pending, new Error('The plugin form timed out after 5 minutes.'))
    }, this.timeouts.form)
    this.pendingForm = pending
    const presentation: PluginFormPresentation = {
      invocationId: active.id,
      requestId,
      sessionGeneration: active.sessionGeneration,
      schema,
    }
    try {
      this.host.presentForm(presentation)
    } catch (error) {
      this.abortPendingForm(pending, toError(error))
    }
  }

  private clearPendingForm(pending: PendingForm): void {
    if (this.pendingForm !== pending) return
    this.pendingForm = null
    window.clearTimeout(pending.timeoutId)
    this.host.dismissForm(pending.requestId)
  }

  private abortPendingForm(pending: PendingForm, error: Error): void {
    if (this.pendingForm !== pending) return
    this.clearPendingForm(pending)
    pending.frame.frame.contentWindow?.postMessage({
      kind: 'response',
      requestId: pending.requestId,
      success: false,
      value: undefined,
      message: error.message.slice(0, 500),
    }, '*')
    const active = pending.frame.active
    if (active?.id === pending.invocationId) this.finishInvocation(pending.frame, pending.invocationId, error, false)
  }

  private pauseExecutionTimeout(active: ActiveInvocation): void {
    if (active.timeoutId === null || active.timeoutStartedAt === null) return
    window.clearTimeout(active.timeoutId)
    active.timeoutId = null
    active.remainingExecutionMs = Math.max(0, active.remainingExecutionMs - (Date.now() - active.timeoutStartedAt))
    active.timeoutStartedAt = null
  }

  private resumeExecutionTimeout(active: ActiveInvocation, frame: PluginFrame): void {
    if (active.cancelled || frame.active !== active || active.timeoutId !== null) return
    if (active.remainingExecutionMs <= 0) {
      this.finishInvocation(frame, active.id, new Error('The plugin command took too long.'), false)
      return
    }
    active.timeoutStartedAt = Date.now()
    active.timeoutId = window.setTimeout(() => {
      this.finishInvocation(frame, active.id, new Error('The plugin command took too long.'), false)
    }, active.remainingExecutionMs)
  }

  private finishInvocation(frame: PluginFrame, invocationId: string, error: Error | null, shouldCommit: boolean): void {
    const active = frame.active
    if (!active || active.id !== invocationId) return
    const pending = this.pendingForm
    if (pending?.frame === frame && pending.invocationId === invocationId) {
      this.clearPendingForm(pending)
      pending.frame.frame.contentWindow?.postMessage({
        kind: 'response',
        requestId: pending.requestId,
        success: false,
        value: undefined,
        message: (error?.message ?? 'The plugin command ended while its form was open.').slice(0, 500),
      }, '*')
    }
    frame.active = null
    if (active.timeoutId !== null) window.clearTimeout(active.timeoutId)
    active.timeoutId = null

    if (shouldCommit && !active.cancelled) {
      try {
        active.transaction.commit()
        active.resolve()
        return
      } catch (commitError) {
        error = toError(commitError)
      }
    }

    active.transaction.rollback()
    if (active.cancelled && !error) active.resolve()
    else active.reject(error ?? new Error('The plugin command failed.'))
  }
}
