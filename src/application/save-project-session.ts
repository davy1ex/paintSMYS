import { createId } from '../core/document/scene-document'
import { createProjectManifest, serializeProjectManifest } from '../core/project/project-manifest'
import type { ProjectSaveMode, ProjectSavePort } from './project-save-port'
import type { ProjectSession } from './project-session'

export type SaveProjectSessionResult =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'saved'; session: ProjectSession }

export function mergeSavedProjectSession(
  snapshot: ProjectSession,
  current: ProjectSession | null,
  saved: ProjectSession,
): ProjectSession | null {
  if (!current || current.projectId !== snapshot.projectId) return null
  return {
    ...saved,
    document: current.document,
    // A completed write only covers the exact document snapshot sent to Main.
    isDirty: current.document !== snapshot.document,
  }
}

export async function saveProjectSession(
  session: ProjectSession,
  savePort: ProjectSavePort,
  requestedMode: ProjectSaveMode = 'save',
): Promise<SaveProjectSessionResult> {
  const mode = requestedMode === 'save' && session.projectRoot === null ? 'save-as' : requestedMode
  const projectId = mode === 'save-as' ? createId() : session.projectId
  const manifest = createProjectManifest(projectId, session.projectName, session.document)

  let result
  try {
    result = await savePort.saveProject({
      manifestText: serializeProjectManifest(manifest),
      projectName: session.projectName,
      projectRoot: session.projectRoot,
      mode,
    })
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'The project could not be saved.' }
  }

  if (result.status !== 'saved') return result

  return {
    status: 'saved',
    session: {
      ...session,
      projectId,
      projectName: result.projectName,
      projectRoot: result.projectRoot,
      isDirty: false,
    },
  }
}
