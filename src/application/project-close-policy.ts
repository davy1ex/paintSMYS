import type { ProjectSession } from './project-session'
import type { SaveProjectSessionResult } from './save-project-session'

export function requiresCloseConfirmation(session: ProjectSession | null): boolean {
  return Boolean(session && (session.isDirty || session.projectRoot === null))
}

export function canCloseAfterSave(
  result: SaveProjectSessionResult | null,
  activeSession: ProjectSession | null,
): boolean {
  return Boolean(
    result?.status === 'saved' &&
    activeSession &&
    activeSession.projectId === result.session.projectId &&
    activeSession.projectRoot !== null &&
    !activeSession.isDirty,
  )
}
