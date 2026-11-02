import type { SceneDocument } from '../../core/document/scene-document'

export const PLUGIN_API_VERSION = 0
export const MAX_PLUGIN_SOURCE_BYTES = 768 * 1024
export const MAX_PLUGIN_MANIFEST_BYTES = 16 * 1024
export const MAX_PLUGIN_BATCH_OBJECTS = 500
export const MAX_PLUGIN_FORM_FIELDS = 16
export const MAX_PLUGIN_FORM_OPTIONS = 32
export const MAX_PLUGIN_FORM_SCHEMA_BYTES = 64 * 1024
export const MAX_PLUGIN_FORM_RESPONSE_BYTES = 32 * 1024
export const MAX_PLUGIN_FORM_TEXT_LENGTH = 1024
export const MAX_PLUGIN_FORM_TEXTAREA_LENGTH = 16 * 1024

export type PluginFormOption = { value: string; label: string }
export type PluginTextFormField = {
  id: string
  type: 'text'
  label: string
  defaultValue?: string
  required?: boolean
}
export type PluginTextareaFormField = {
  id: string
  type: 'textarea'
  label: string
  defaultValue?: string
  required?: boolean
}
export type PluginSelectFormField = {
  id: string
  type: 'select'
  label: string
  defaultValue?: string
  required?: boolean
  options: PluginFormOption[]
}
export type PluginFormField = PluginTextFormField | PluginTextareaFormField | PluginSelectFormField
export type PluginFormSchema = {
  title: string
  fields: PluginFormField[]
  submitLabel?: string
}
export type PluginFormResult =
  | { status: 'submitted'; values: Record<string, string> }
  | { status: 'cancelled' }
export type PluginFormPresentation = {
  invocationId: string
  requestId: string
  sessionGeneration: number
  schema: PluginFormSchema
}

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
  isSessionCurrent: (sessionToken: number) => boolean
  presentForm: (form: PluginFormPresentation) => void
  dismissForm: (requestId: string) => void
}

export type PluginLoadResult = {
  commands: PluginMenuCommand[]
  errors: string[]
}

export type PluginRuntime = {
  load: () => Promise<PluginLoadResult>
  invoke: (pluginId: string, commandId: string, sessionToken: number) => Promise<void>
  submitForm: (requestId: string, values: unknown) => void
  cancelForm: (requestId: string) => void
  cancelPendingForm: (reason?: string) => void
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

function serializedSize(value: unknown, label: string): number {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${label} must contain only JSON-compatible values.`)
  }
  if (serialized === undefined) throw new Error(`${label} must contain only JSON-compatible values.`)
  return new TextEncoder().encode(serialized).byteLength
}

function isShortText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
}

function validateFormField(value: unknown, index: number): PluginFormField {
  if (!isRecord(value)) throw new Error(`Form field ${index + 1} must be an object.`)
  const id = value.id
  const label = value.label
  if (typeof id !== 'string' || id.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) {
    throw new Error(`Form field ${index + 1} has an invalid ID.`)
  }
  if (!isShortText(label, 80) || !label.trim()) throw new Error(`Form field "${id}" has an invalid label.`)
  if (value.required !== undefined && typeof value.required !== 'boolean') {
    throw new Error(`Form field "${id}" required must be a boolean.`)
  }
  if (value.defaultValue !== undefined && typeof value.defaultValue !== 'string') {
    throw new Error(`Form field "${id}" defaultValue must be a string.`)
  }

  if (value.type === 'text' || value.type === 'textarea') {
    if (!hasOnlyKeys(value, ['id', 'type', 'label', 'defaultValue', 'required'])) {
      throw new Error(`Form field "${id}" contains an unknown property.`)
    }
    const maxLength = value.type === 'text' ? MAX_PLUGIN_FORM_TEXT_LENGTH : MAX_PLUGIN_FORM_TEXTAREA_LENGTH
    if (value.defaultValue !== undefined && !isShortText(value.defaultValue, maxLength)) {
      throw new Error(`Form field "${id}" has an invalid defaultValue.`)
    }
    return {
      id,
      type: value.type,
      label,
      ...(value.defaultValue === undefined ? {} : { defaultValue: value.defaultValue }),
      ...(value.required === undefined ? {} : { required: value.required }),
    }
  }

  if (value.type !== 'select') throw new Error(`Form field "${id}" has an unsupported field type.`)
  if (!hasOnlyKeys(value, ['id', 'type', 'label', 'defaultValue', 'required', 'options'])) {
    throw new Error(`Form field "${id}" contains an unknown property.`)
  }
  if (!Array.isArray(value.options) || value.options.length === 0 || value.options.length > MAX_PLUGIN_FORM_OPTIONS) {
    throw new Error(`Select field "${id}" must have between 1 and ${MAX_PLUGIN_FORM_OPTIONS} options.`)
  }
  const optionValues = new Set<string>()
  const options = value.options.map((option, optionIndex): PluginFormOption => {
    if (!isRecord(option) || !hasOnlyKeys(option, ['value', 'label']) ||
        !isShortText(option.value, 256) || !isShortText(option.label, 80) || !option.label.trim()) {
      throw new Error(`Select field "${id}" option ${optionIndex + 1} is invalid.`)
    }
    if (optionValues.has(option.value)) throw new Error(`Select field "${id}" options must have unique values.`)
    optionValues.add(option.value)
    return { value: option.value, label: option.label }
  })
  if (value.defaultValue !== undefined && !optionValues.has(value.defaultValue as string)) {
    throw new Error(`Select field "${id}" defaultValue must match one of its options.`)
  }
  return {
    id,
    type: 'select',
    label,
    options,
    ...(value.defaultValue === undefined ? {} : { defaultValue: value.defaultValue as string }),
    ...(value.required === undefined ? {} : { required: value.required }),
  }
}

/** Validate and copy a plugin-provided form schema before it reaches the renderer. */
export function validatePluginFormSchema(value: unknown): PluginFormSchema {
  if (serializedSize(value, 'The plugin form schema') > MAX_PLUGIN_FORM_SCHEMA_BYTES) {
    throw new Error(`The plugin form schema exceeds ${MAX_PLUGIN_FORM_SCHEMA_BYTES} bytes.`)
  }
  if (!isRecord(value) || !hasOnlyKeys(value, ['title', 'fields', 'submitLabel'])) {
    throw new Error('The plugin form schema must contain only title, fields, and submitLabel.')
  }
  if (!isShortText(value.title, 80) || !value.title.trim()) throw new Error('The plugin form title is invalid.')
  if (value.submitLabel !== undefined && (!isShortText(value.submitLabel, 32) || !value.submitLabel.trim())) {
    throw new Error('The plugin form submitLabel is invalid.')
  }
  if (!Array.isArray(value.fields) || value.fields.length === 0 || value.fields.length > MAX_PLUGIN_FORM_FIELDS) {
    throw new Error(`A plugin form must have between 1 and ${MAX_PLUGIN_FORM_FIELDS} fields.`)
  }
  const ids = new Set<string>()
  const fields = value.fields.map((field, index) => {
    const validated = validateFormField(field, index)
    if (ids.has(validated.id)) throw new Error(`Form field ID "${validated.id}" is duplicated.`)
    ids.add(validated.id)
    return validated
  })
  return {
    title: value.title,
    fields,
    ...(value.submitLabel === undefined ? {} : { submitLabel: value.submitLabel }),
  }
}

/** Validate values coming back from the host-rendered dialog and bound their bridge payload. */
export function validatePluginFormValues(schema: PluginFormSchema, value: unknown): Record<string, string> {
  if (!isRecord(value) || !hasOnlyKeys(value, schema.fields.map(({ id }) => id))) {
    throw new Error('The submitted plugin form values do not match the form fields.')
  }
  const values: Record<string, string> = {}
  for (const field of schema.fields) {
    const submitted = value[field.id]
    const maxLength = field.type === 'textarea' ? MAX_PLUGIN_FORM_TEXTAREA_LENGTH : MAX_PLUGIN_FORM_TEXT_LENGTH
    if (typeof submitted !== 'string' || !isShortText(submitted, maxLength)) {
      throw new Error(`The submitted value for "${field.label}" is invalid or too long.`)
    }
    if (field.required && !submitted.trim()) throw new Error(`"${field.label}" is required.`)
    if (field.type === 'select' && !field.options.some(({ value: optionValue }) => optionValue === submitted)) {
      throw new Error(`The submitted value for "${field.label}" is not one of its options.`)
    }
    values[field.id] = submitted
  }
  if (serializedSize({ status: 'submitted', values }, 'The plugin form response') > MAX_PLUGIN_FORM_RESPONSE_BYTES) {
    throw new Error(`The plugin form response exceeds ${MAX_PLUGIN_FORM_RESPONSE_BYTES} bytes.`)
  }
  return values
}

export function createPluginFormDefaults(schema: PluginFormSchema): Record<string, string> {
  return Object.fromEntries(schema.fields.map((field) => [
    field.id,
    field.defaultValue ?? (field.type === 'select' ? field.options[0].value : ''),
  ]))
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
