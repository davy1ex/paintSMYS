import { useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  createPluginFormDefaults,
  MAX_PLUGIN_FORM_TEXTAREA_LENGTH,
  MAX_PLUGIN_FORM_TEXT_LENGTH,
  validatePluginFormValues,
  type PluginFormPresentation,
} from '../application/plugins/plugin-api'

type PluginFormDialogProps = {
  request: PluginFormPresentation | null
  onSubmit: (requestId: string, values: Record<string, string>) => void
  onCancel: (requestId: string) => void
}

function PluginFormDialog({ request, onSubmit, onCancel }: PluginFormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState('')
  const defaults = useMemo(() => request ? createPluginFormDefaults(request.schema) : {}, [request])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (request) {
      if (!dialog.open) {
        previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        dialog.showModal()
      }
      dialog.querySelector<HTMLElement>('[data-plugin-form-autofocus]')?.focus()
    } else if (!request && dialog.open) {
      dialog.close()
      const previousFocus = previousFocusRef.current
      if (previousFocus?.isConnected) previousFocus.focus()
      previousFocusRef.current = null
    }
  }, [request])

  useLayoutEffect(() => {
    setValues(defaults)
    setFormError('')
  }, [defaults])

  const validationError = request ? (() => {
    try {
      validatePluginFormValues(request.schema, values)
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : 'Check the form values and try again.'
    }
  })() : ''
  const canSubmit = Boolean(request && !validationError)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!request) return
    try {
      const validated = validatePluginFormValues(request.schema, values)
      onSubmit(request.requestId, validated)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check the form values and try again.')
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="plugin-form-dialog"
      aria-labelledby="plugin-form-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (request) onCancel(request.requestId)
      }}
    >
      {request && <>
        <div className="plugin-form-dialog__titlebar" id="plugin-form-dialog-title">{request.schema.title}</div>
        <form className="plugin-form-dialog__body" onSubmit={submit}>
          <div className="plugin-form-dialog__fields">
            {request.schema.fields.map((field, index) => {
              const fieldId = `plugin-form-field-${field.id}`
              let control: ReactNode
              const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
                setValues((current) => ({ ...current, [field.id]: event.target.value }))
                setFormError('')
              }
              if (field.type === 'text') {
                control = <input
                  id={fieldId}
                  name={field.id}
                  required={field.required}
                  value={values[field.id] ?? ''}
                  maxLength={MAX_PLUGIN_FORM_TEXT_LENGTH}
                  data-plugin-form-autofocus={index === 0 ? '' : undefined}
                  onChange={onChange}
                  type="text"
                />
              } else if (field.type === 'textarea') {
                control = <textarea
                  id={fieldId}
                  name={field.id}
                  required={field.required}
                  value={values[field.id] ?? ''}
                  maxLength={MAX_PLUGIN_FORM_TEXTAREA_LENGTH}
                  data-plugin-form-autofocus={index === 0 ? '' : undefined}
                  onChange={onChange}
                  rows={5}
                />
              } else {
                control = <select
                  id={fieldId}
                  name={field.id}
                  required={field.required}
                  value={values[field.id] ?? ''}
                  data-plugin-form-autofocus={index === 0 ? '' : undefined}
                  onChange={onChange}
                >
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              }
              return <label className="plugin-form-dialog__field" htmlFor={fieldId} key={field.id}>
                <span>{field.label}{field.required ? <span aria-hidden="true"> *</span> : null}</span>
                {control}
              </label>
            })}
          </div>
          {(formError || validationError) && <div className="plugin-form-dialog__error" role="alert">{formError || validationError}</div>}
          <div className="plugin-form-dialog__actions">
            <button className="win95-button plugin-form-dialog__button win95-button--primary" type="submit" disabled={!canSubmit}>
              {request.schema.submitLabel ?? 'OK'}
            </button>
            <button className="win95-button plugin-form-dialog__button" type="button" onClick={() => onCancel(request.requestId)}>
              Cancel
            </button>
          </div>
        </form>
      </>}
    </dialog>
  )
}

export default PluginFormDialog
