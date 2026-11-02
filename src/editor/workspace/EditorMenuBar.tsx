import { Fragment, useEffect, useRef, useState } from 'react'

const fileActions = ['New Project', 'Open Project…', 'Save', 'Save As…', 'Export PNG…', 'Exit']

type EditorMenuBarProps = {
  canSave: boolean
  isSaving: boolean
  canExportPng: boolean
  isExporting: boolean
  canUndo: boolean
  canRedo: boolean
  onSave: () => void
  onSaveAs: () => void
  onExportPng: () => void
  onUndo: () => void
  onRedo: () => void
  onMockAction: (action: string) => void
}

function EditorMenuBar({
  canSave,
  isSaving,
  canExportPng,
  isExporting,
  canUndo,
  canRedo,
  onSave,
  onSaveAs,
  onExportPng,
  onUndo,
  onRedo,
  onMockAction,
}: EditorMenuBarProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [editMenuOpen, setEditMenuOpen] = useState(false)
  const fileGroupRef = useRef<HTMLDivElement>(null)
  const editGroupRef = useRef<HTMLDivElement>(null)
  const fileButtonRef = useRef<HTMLButtonElement>(null)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const editMenuRef = useRef<HTMLDivElement>(null)
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

  useEffect(() => {
    if (!fileMenuOpen && !editMenuOpen) return

    const activeMenu = editMenuOpen ? editMenuRef.current : fileMenuRef.current
    activeMenu?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!fileGroupRef.current?.contains(target) && !editGroupRef.current?.contains(target)) {
        setFileMenuOpen(false)
        setEditMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setFileMenuOpen(false)
      setEditMenuOpen(false)
      if (editMenuOpen) editButtonRef.current?.focus()
      else fileButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [editMenuOpen, fileMenuOpen])

  const moveMenuFocus = (menuRef: React.RefObject<HTMLDivElement | null>, key: string) => {
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    if (!items?.length) return

    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex = currentIndex
    if (key === 'ArrowDown') nextIndex = (currentIndex + 1) % items.length
    if (key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length
    if (key === 'Home') nextIndex = 0
    if (key === 'End') nextIndex = items.length - 1
    items[nextIndex]?.focus()
  }

  const closeFileMenu = () => {
    setFileMenuOpen(false)
    fileButtonRef.current?.focus()
  }
  const closeEditMenu = () => {
    setEditMenuOpen(false)
    editButtonRef.current?.focus()
  }

  return (
    <nav className="editor-menu-bar" aria-label="Main menu">
      <div className="editor-menu-group" ref={fileGroupRef}>
        <button
          className="editor-menu-trigger"
          type="button"
          ref={fileButtonRef}
          aria-haspopup="menu"
          aria-expanded={fileMenuOpen}
          aria-controls="editor-file-menu"
          onClick={() => {
            setEditMenuOpen(false)
            setFileMenuOpen((open) => !open)
          }}
        >
          File
        </button>
        {fileMenuOpen && (
          <div
            className="editor-file-menu"
            id="editor-file-menu"
            role="menu"
            aria-label="File"
            ref={fileMenuRef}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                moveMenuFocus(fileMenuRef, event.key)
              }
            }}
          >
            {fileActions.map((action, index) => (
              <Fragment key={action}>
                {(index === 4 || index === 5) && <div className="editor-file-menu__separator" role="separator" />}
                <button
                  className="editor-file-menu__item"
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  disabled={
                    ((action === 'Save' || action === 'Save As…') && (!canSave || isSaving)) ||
                    (action === 'Export PNG…' && (!canExportPng || isExporting))
                  }
                  onClick={() => {
                    if (action === 'Save') onSave()
                    else if (action === 'Save As…') onSaveAs()
                    else if (action === 'Export PNG…') onExportPng()
                    else onMockAction(action)
                    closeFileMenu()
                  }}
                >
                  {action === 'Save' && !canSave
                    ? 'Save (Unavailable)'
                    : action === 'Save As…' && !canSave
                      ? 'Save As… (Unavailable)'
                      : action === 'Export PNG…' && isExporting
                        ? 'Exporting PNG…'
                        : action}
                </button>
              </Fragment>
            ))}
          </div>
        )}
      </div>
      <div className="editor-menu-group" ref={editGroupRef}>
        <button
          className="editor-menu-trigger"
          type="button"
          ref={editButtonRef}
          aria-haspopup="menu"
          aria-expanded={editMenuOpen}
          aria-controls="editor-edit-menu"
          onClick={() => {
            setFileMenuOpen(false)
            setEditMenuOpen((open) => !open)
          }}
        >
          Edit
        </button>
        {editMenuOpen && (
          <div
            className="editor-edit-menu"
            id="editor-edit-menu"
            role="menu"
            aria-label="Edit"
            ref={editMenuRef}
            onKeyDown={(event) => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                moveMenuFocus(editMenuRef, event.key)
              }
            }}
          >
            <button
              className="editor-edit-menu__item"
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!canUndo}
              onClick={() => { onUndo(); closeEditMenu() }}
            >
              <span>Undo</span><span className="editor-edit-menu__shortcut">{isMac ? '⌘Z' : 'Ctrl+Z'}</span>
            </button>
            <button
              className="editor-edit-menu__item"
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={!canRedo}
              onClick={() => { onRedo(); closeEditMenu() }}
            >
              <span>Redo</span><span className="editor-edit-menu__shortcut">{isMac ? '⌘⇧Z' : 'Ctrl+Y / Ctrl+Shift+Z'}</span>
            </button>
          </div>
        )}
      </div>
      <span>View</span><span>Help</span>
    </nav>
  )
}

export default EditorMenuBar
