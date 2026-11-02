import { Fragment, useEffect, useRef, useState } from 'react'

const fileActions = ['New Project', 'Open Project…', 'Save', 'Save As…', 'Exit']

type EditorMenuBarProps = {
  canSave: boolean
  isSaving: boolean
  onSave: () => void
  onSaveAs: () => void
  onMockAction: (action: string) => void
}

function EditorMenuBar({ canSave, isSaving, onSave, onSaveAs, onMockAction }: EditorMenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const menuGroupRef = useRef<HTMLDivElement>(null)
  const fileButtonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!fileMenuOpen) return

    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuGroupRef.current?.contains(event.target as Node)) {
        setFileMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setFileMenuOpen(false)
        fileButtonRef.current?.focus()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [fileMenuOpen])

  const moveMenuFocus = (key: string) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')
    if (!items?.length) return

    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex
    if (key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
    if (key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
    if (key === 'Home') nextIndex = 0
    if (key === 'End') nextIndex = items.length - 1
    items[nextIndex]?.focus()
  }

  return (
    <nav className="editor-menu-bar" aria-label="Main menu">
      <div className="editor-menu-group" ref={menuGroupRef}>
        <button
          className="editor-menu-trigger"
          type="button"
          ref={fileButtonRef}
          aria-haspopup="menu"
          aria-expanded={fileMenuOpen}
          aria-controls="editor-file-menu"
          onClick={() => setFileMenuOpen((open) => !open)}
        >
          File
        </button>
        {fileMenuOpen && (
          <div
            className="editor-file-menu"
            id="editor-file-menu"
            role="menu"
            aria-label="File"
            ref={menuRef}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                moveMenuFocus(event.key)
              }
            }}
          >
            {fileActions.map((action, index) => (
              <Fragment key={action}>
                {index === 4 && <div className="editor-file-menu__separator" role="separator" />}
                <button
                  className="editor-file-menu__item"
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={(action === 'Save' || action === 'Save As…') && (!canSave || isSaving)}
                  onClick={() => {
                    if (action === 'Save') onSave()
                    else if (action === 'Save As…') onSaveAs()
                    else onMockAction(action)
                    setFileMenuOpen(false)
                    fileButtonRef.current?.focus()
                  }}
                >
                  {action === 'Save' && !canSave ? 'Save (Unavailable)' : action === 'Save As…' && !canSave ? 'Save As… (Unavailable)' : action}
                </button>
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <span>Edit</span><span>View</span><span>Help</span>
    </nav>
  )
}

export default EditorMenuBar
