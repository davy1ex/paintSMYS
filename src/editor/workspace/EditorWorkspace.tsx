import './editor-workspace.css'

function EditorWorkspace() {
  return (
    <main className="app-shell">
      <nav className="menu-bar" aria-label="Главное меню">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </nav>

      <section className="welcome-panel">
        <div className="paint-icon" aria-hidden="true">P</div>
        <h1>Hello, world!</h1>
      </section>
    </main>
  )
}

export default EditorWorkspace
