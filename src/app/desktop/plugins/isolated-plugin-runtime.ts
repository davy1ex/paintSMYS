import {
  MAX_PLUGIN_SOURCE_BYTES,
  parsePluginManifest,
  validateRegisteredPluginCommands,
  type LoadedPlugin,
  type PluginCatalog,
  type PluginCommandManifest,
  type PluginHost,
  type PluginMenuCommand,
  type PluginRuntime,
} from '../../../application/plugins/plugin-api'

const PLUGIN_LOAD_TIMEOUT_MS = 8_000
const PLUGIN_COMMAND_TIMEOUT_MS = 60_000

type ActiveInvocation = {
  id: string
  transaction: ReturnType<PluginHost['beginCommand']>
  resolve: () => void
  reject: (error: Error) => void
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

export class IsolatedPluginRuntime implements PluginRuntime {
  private readonly frames = new Map<string, PluginFrame>()
  private readonly pendingFrames = new Set<PluginFrame>()
  private readonly commandFrames = new Map<string, PluginFrame>()
  private nextInvocationId = 0
  private disposed = false

  constructor(private readonly getCatalog: () => Promise<PluginCatalog>, private readonly host: PluginHost) {}

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
      const timeoutId = window.setTimeout(() => {
        this.finishInvocation(frame, invocationId, new Error('The plugin command took too long.'), false)
      }, PLUGIN_COMMAND_TIMEOUT_MS)
      frame.active = { id: invocationId, transaction, resolve, reject, timeoutId }
      frame.frame.contentWindow?.postMessage({ kind: 'invoke', commandId, invocationId }, '*')
    })
  }

  dispose(): void {
    this.disposed = true
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

      window.addEventListener('message', onMessage)
      frame.addEventListener('load', () => {
        frame.contentWindow?.postMessage({
          kind: 'initialize',
          source: plugin.source,
          commandIds: plugin.manifest.commands.map(({ id }) => id),
        }, '*')
      }, { once: true })
      pluginFrame.loadTimer = window.setTimeout(() => {
        finishLoad({ commands: [], error: 'The plugin did not finish loading in time.' })
      }, PLUGIN_LOAD_TIMEOUT_MS)
      frame.src = new URL('plugin-runtime.html', window.location.href).toString()
      document.body.appendChild(frame)
    })
  }

  private async handleRequest(pluginFrame: PluginFrame, data: Record<string, unknown>): Promise<void> {
    const active = pluginFrame.active
    const requestId = typeof data.requestId === 'string' && data.requestId.length <= 160 ? data.requestId : null
    const invocationId = typeof data.invocationId === 'string' ? data.invocationId : null
    let success = false
    let value: unknown
    let message = 'The plugin request is invalid.'

    try {
      if (!active || !requestId || !invocationId || active.id !== invocationId || !Array.isArray(data.args)) {
        throw new Error('The plugin command is no longer active.')
      }
      if (data.method === 'snapshot-document' && data.args.length === 0) {
        value = active.transaction.snapshotDocument()
      } else if (data.method === 'add-objects' && data.args.length === 1) {
        active.transaction.addObjects(data.args[0])
      } else if (data.method === 'show-error' && data.args.length === 1 && typeof data.args[0] === 'string') {
        this.host.showError(data.args[0].slice(0, 500))
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

  private finishInvocation(frame: PluginFrame, invocationId: string, error: Error | null, shouldCommit: boolean): void {
    const active = frame.active
    if (!active || active.id !== invocationId) return
    frame.active = null
    window.clearTimeout(active.timeoutId)

    if (shouldCommit) {
      try {
        active.transaction.commit()
        active.resolve()
        return
      } catch (commitError) {
        error = toError(commitError)
      }
    }

    active.transaction.rollback()
    active.reject(error ?? new Error('The plugin command failed.'))
  }
}
