import { validateSceneDocument, type SceneDocument } from '../document/scene-document'

export const PROJECT_FORMAT = 'paintSMYS'
export const PROJECT_FORMAT_VERSION = 1

export type ProjectManifest = {
  format: typeof PROJECT_FORMAT
  formatVersion: typeof PROJECT_FORMAT_VERSION
  project: { id: string; name: string }
  scene: SceneDocument
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFormatError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseProjectManifest(text: string): ProjectManifest {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new ProjectFormatError('project.json is not valid JSON.')
  }

  if (!isRecord(value)) throw new ProjectFormatError('project.json must contain a project object.')
  if (value.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError(`This folder is not a ${PROJECT_FORMAT} project.`)
  }
  if (value.formatVersion !== PROJECT_FORMAT_VERSION) {
    throw new ProjectFormatError(`Project format version ${String(value.formatVersion)} is not supported.`)
  }
  if (!isRecord(value.project) || typeof value.project.id !== 'string' || !value.project.id) {
    throw new ProjectFormatError('The project metadata is missing its ID.')
  }
  if (typeof value.project.name !== 'string' || !value.project.name.trim()) {
    throw new ProjectFormatError('The project metadata is missing its name.')
  }

  try {
    return {
      format: PROJECT_FORMAT,
      formatVersion: PROJECT_FORMAT_VERSION,
      project: { id: value.project.id, name: value.project.name.trim() },
      scene: validateSceneDocument(value.scene),
    }
  } catch (error) {
    if (error instanceof Error) throw new ProjectFormatError(error.message)
    throw new ProjectFormatError('The scene data is invalid.')
  }
}
