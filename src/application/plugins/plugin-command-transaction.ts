import { appendSceneObjects, type SceneDocument } from '../../core/document/scene-document'
import { MAX_PLUGIN_BATCH_OBJECTS, type PluginCommandTransaction } from './plugin-api'

/** Stages all object batches from one plugin command and publishes them only on commit. */
export function createPluginCommandTransaction(
  initialDocument: SceneDocument,
  onCommit: (document: SceneDocument) => void,
): PluginCommandTransaction {
  let stagedDocument = initialDocument
  let addedObjectCount = 0
  let isOpen = true

  function assertOpen() {
    if (!isOpen) throw new Error('This plugin command has already finished.')
  }

  return {
    snapshotDocument() {
      assertOpen()
      return structuredClone(stagedDocument)
    },
    addObjects(objects) {
      assertOpen()
      if (!Array.isArray(objects) || objects.length === 0) {
        throw new Error('At least one scene object is required.')
      }
      if (addedObjectCount + objects.length > MAX_PLUGIN_BATCH_OBJECTS) {
        throw new Error(`A plugin command can add at most ${MAX_PLUGIN_BATCH_OBJECTS} objects.`)
      }

      const nextDocument = appendSceneObjects(stagedDocument, objects)
      stagedDocument = nextDocument
      addedObjectCount += objects.length
    },
    commit() {
      assertOpen()
      if (stagedDocument !== initialDocument) onCommit(stagedDocument)
      isOpen = false
    },
    rollback() {
      isOpen = false
    },
  }
}
