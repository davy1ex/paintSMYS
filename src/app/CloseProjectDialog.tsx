import { useLayoutEffect, useRef } from 'react'

export type ClosePrompt = {
  requestId: number
  message: string
}

type CloseProjectDialogProps = {
  request: ClosePrompt | null
  projectName: string
  isSaving: boolean
  onSave: () => void
  onDontSave: () => void
  onCancel: () => void
}

function CloseProjectDialog({ request, projectName, isSaving, onSave, onDontSave, onCancel }: CloseProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (request && !dialog.open) dialog.showModal()
    else if (!request && dialog.open) dialog.close()
  }, [request])

  return (
    <dialog
      ref={dialogRef}
      className="close-project-dialog"
      aria-labelledby="close-project-dialog-title"
      onCancel={(event) => { event.preventDefault(); onCancel() }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
        }
      }}
    >
      <div className="close-project-dialog__titlebar" id="close-project-dialog-title">
        paintSMYS
      </div>
      <div className="close-project-dialog__body">
        <p>Save changes to &quot;{projectName}&quot;?</p>
        {request?.message && <div className="close-project-dialog__message" role="status">{request.message}</div>}
        <div className="close-project-dialog__actions">
          <button className="win95-button close-project-dialog__button" type="button" autoFocus disabled={isSaving} onClick={onSave}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
          <button className="win95-button close-project-dialog__button" type="button" disabled={isSaving} onClick={onDontSave}>
            Don&apos;t Save
          </button>
          <button className="win95-button close-project-dialog__button" type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  )
}

export default CloseProjectDialog
