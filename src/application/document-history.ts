import type { SceneDocument } from '../core/document/scene-document'

export const DEFAULT_DOCUMENT_HISTORY_LIMIT = 100

/**
 * Keeps immutable document snapshots around the active ProjectSession document.
 * The session remains the only source of truth for the current document.
 */
export class DocumentHistory {
  private readonly undoStack: SceneDocument[] = []
  private readonly redoStack: SceneDocument[] = []
  private savedBaseline: SceneDocument | null

  constructor(
    savedDocument: SceneDocument | null = null,
    private readonly limit = DEFAULT_DOCUMENT_HISTORY_LIMIT,
  ) {
    this.savedBaseline = savedDocument
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  recordChange(previousDocument: SceneDocument, nextDocument: SceneDocument): boolean {
    if (previousDocument === nextDocument) return false

    this.pushUndo(previousDocument)
    this.redoStack.length = 0
    return true
  }

  undo(currentDocument: SceneDocument): SceneDocument | null {
    const previousDocument = this.undoStack.pop()
    if (!previousDocument) return null

    this.redoStack.push(currentDocument)
    return previousDocument
  }

  redo(currentDocument: SceneDocument): SceneDocument | null {
    const nextDocument = this.redoStack.pop()
    if (!nextDocument) return null

    this.pushUndo(currentDocument)
    return nextDocument
  }

  markSaved(savedDocument: SceneDocument): void {
    this.savedBaseline = savedDocument
  }

  isDirty(currentDocument: SceneDocument): boolean {
    return this.savedBaseline === null || currentDocument !== this.savedBaseline
  }

  private pushUndo(document: SceneDocument): void {
    if (this.limit <= 0) return
    this.undoStack.push(document)
    if (this.undoStack.length > this.limit) this.undoStack.splice(0, this.undoStack.length - this.limit)
  }
}
