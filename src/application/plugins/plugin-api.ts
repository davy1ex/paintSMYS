import type { SceneDocument } from '../../core/document/scene-document'

export const PLUGIN_API_VERSION = 0
export const MAX_PLUGIN_SOURCE_BYTES = 256 * 1024
export const MAX_PLUGIN_MANIFEST_BYTES = 16 * 1024
export const MAX_PLUGIN_BATCH_OBJECTS = 500

export type PluginCommandManifest = {
  id: string
  name: string
}

export type PluginManifest = {
  id: string
  name: string
  version: string
  apiVersion: number
  entry: string
  commands: PluginCommandManifest[]
}

export type LoadedPlugin = {
  manifest: PluginManifest
  source: string
}

export type PluginCatalog = {
  plugins: LoadedPlugin[]
  errors: string[]
}

export type PluginMenuCommand = PluginCommandManifest & {
  pluginId: string
  pluginName: string
}

export type PluginCommandTransaction = {
  snapshotDocument: () => SceneDocument
  addObjects: (objects: unknown) => void
  commit: () => void
  rollback: () => void
}

export type PluginHost = {
  beginCommand: (sessionToken: number) => PluginCommandTransaction
  showError: (message: string) => void
}

export type PluginLoadResult = {
  commands: PluginMenuCommand[]
  errors: string[]
}

export type PluginRuntime = {
  load: () => Promise<PluginLoadResult>
  invoke: (pluginId: string, commandId: string, sessionToken: number) => Promise<void>
  dispose: () => void
}

export type PluginRuntimeFactory = (host: PluginHost) => PluginRuntime

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PluginManifestError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function isPluginId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)
}

function isCommandId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)
}

function isDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80
}

function isVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(value)
}

function isEntryPoint(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 &&
    /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.js$/.test(value)
}

export function parsePluginManifest(value: unknown): PluginManifest {
  if (!isRecord(value) || !hasOnlyKeys(value, ['id', 'name', 'version', 'apiVersion', 'entry', 'commands'])) {
    throw new PluginManifestError('The plugin manifest must be an object with only supported fields.')
  }
  if (!isPluginId(value.id)) throw new PluginManifestError('The plugin ID is invalid.')
  if (!isDisplayName(value.name)) throw new PluginManifestError('The plugin name is invalid.')
  if (!isVersion(value.version)) throw new PluginManifestError('The plugin version must use x.y.z format.')
  if (value.apiVersion !== PLUGIN_API_VERSION) {
    throw new PluginManifestError(`Plugin API version ${String(value.apiVersion)} is not supported.`)
  }
  if (!isEntryPoint(value.entry)) throw new PluginManifestError('The plugin entry point is invalid.')
  if (!Array.isArray(value.commands) || value.commands.length === 0 || value.commands.length > 32) {
    throw new PluginManifestError('A plugin must declare between 1 and 32 commands.')
  }

  const commandIds = new Set<string>()
  const commands = value.commands.map((command, index): PluginCommandManifest => {
    if (!isRecord(command) || !hasOnlyKeys(command, ['id', 'name'])) {
      throw new PluginManifestError(`Command ${index + 1} must contain only an ID and name.`)
    }
    if (!isCommandId(command.id) || commandIds.has(command.id)) {
      throw new PluginManifestError(`Command ${index + 1} has a missing, invalid, or duplicate ID.`)
    }
    if (!isDisplayName(command.name)) throw new PluginManifestError(`Command ${index + 1} has an invalid name.`)
    commandIds.add(command.id)
    return { id: command.id, name: command.name }
  })

  return {
    id: value.id,
    name: value.name,
    version: value.version,
    apiVersion: PLUGIN_API_VERSION,
    entry: value.entry,
    commands,
  }
}

export function parsePluginManifestText(text: string): PluginManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new PluginManifestError('The plugin manifest is not valid JSON.')
  }
  return parsePluginManifest(value)
}

export function validateRegisteredPluginCommands(
  declaredCommands: PluginCommandManifest[],
  registeredIds: unknown,
): PluginCommandManifest[] {
  if (!Array.isArray(registeredIds) || registeredIds.some((id) => typeof id !== 'string')) {
    throw new Error('The plugin returned an invalid command list.')
  }
  const registered = registeredIds as string[]
  const declaredIds = declaredCommands.map(({ id }) => id)
  if (new Set(registered).size !== registered.length || registered.length !== declaredIds.length ||
      declaredIds.some((id) => !registered.includes(id))) {
    throw new Error('The entry point must register every declared command exactly once.')
  }
  return declaredCommands
}

export function getPluginMenuEmptyMessage(commandCount: number, errorCount: number): string | null {
  if (commandCount > 0) return null
  return errorCount > 0 ? 'No plugin commands available' : 'No plugins installed'
}
