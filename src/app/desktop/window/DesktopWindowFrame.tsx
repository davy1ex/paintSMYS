import { useEffect, useState, type ReactNode } from 'react'
import './desktop-window-frame.css'

type DesktopWindowFrameProps = {
  children: ReactNode
}

function DesktopWindowFrame({ children }: DesktopWindowFrameProps) {
  const [maximized, setMaximized] = useState(false)
  const [title, setTitle] = useState(document.title)
  const controls = window.paintSMYS?.windowControls

  useEffect(() => {
    if (!controls) return
    const unsubscribe = controls.onMaximizedChange(setMaximized)
    void controls.isMaximized().then(setMaximized)
    return unsubscribe
  }, [controls])

  useEffect(() => {
    const titleElement = document.querySelector('title')
    if (!titleElement) return
    const updateTitle = () => setTitle(document.title.replace(/\s+[—-]\s+paintSMYS$/, ''))
    const observer = new MutationObserver(updateTitle)
    observer.observe(titleElement, { subtree: true, childList: true, characterData: true })
    updateTitle()
    return () => observer.disconnect()
  }, [])

  return (
    <div className="desktop-frame">
      <header className="desktop-titlebar">
        <span className="desktop-titlebar__icon" aria-hidden="true">P</span>
        <div
          className="desktop-titlebar__drag-region"
          onDoubleClick={() => controls?.toggleMaximize()}
        >
          <span>{title}</span>
        </div>
        <div className="desktop-titlebar__controls">
          <button
            className="desktop-titlebar__button"
            type="button"
            aria-label="Свернуть"
            title="Свернуть"
            onClick={() => controls?.minimize()}
          >
            <span className="desktop-titlebar__minimize" aria-hidden="true" />
          </button>
          <button
            className="desktop-titlebar__button"
            type="button"
            aria-label={maximized ? 'Восстановить' : 'Развернуть'}
            title={maximized ? 'Восстановить' : 'Развернуть'}
            onClick={() => controls?.toggleMaximize()}
          >
            <span className={maximized ? 'desktop-titlebar__restore' : 'desktop-titlebar__maximize'} aria-hidden="true" />
          </button>
          <button
            className="desktop-titlebar__button desktop-titlebar__button--close"
            type="button"
            aria-label="Закрыть"
            title="Закрыть"
            onClick={() => controls?.close()}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}

export default DesktopWindowFrame
