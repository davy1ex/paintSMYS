import { createId, createSceneDocument, type SceneDocument } from '../core/document/scene-document'
import { parseProjectManifest } from '../core/project/project-manifest'

export type ProjectSession = {
  projectId: string
  projectName: string
  document: SceneDocument
  projectRoot: string | null
  isDirty: boolean
}

export function createUntitledProjectSession(width: number, height: number): ProjectSession {
  return {
    projectId: createId(),
    projectName: 'Untitled',
    document: createSceneDocument(width, height),
    projectRoot: null,
    isDirty: true,
  }
}

export function openProjectSession(manifestText: string, projectRoot: string | null): ProjectSession {
  const manifest = parseProjectManifest(manifestText)
  return {
    projectId: manifest.project.id,
    projectName: manifest.project.name,
    document: manifest.scene,
    projectRoot,
    isDirty: false,
  }
}

export function updateProjectSessionDocument(
  session: ProjectSession,
  document: SceneDocument,
  isDirty = true,
): ProjectSession {
  return {
    ...session,
    document,
    isDirty,
  }
}
