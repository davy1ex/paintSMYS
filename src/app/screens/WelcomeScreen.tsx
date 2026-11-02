type WelcomeScreenProps = {
  busy: boolean
  error: string | null
  onNewProject: () => void
  onOpenProject: () => void
}

function WelcomeScreen({ busy, error, onNewProject, onOpenProject }: WelcomeScreenProps) {
  return (
    <main className="startup-window">
      <div className="startup-titlebar">
        <span className="startup-titlebar__icon" aria-hidden="true">P</span>
        <span>paintSMYS</span>
      </div>
      <section className="welcome-screen" aria-labelledby="welcome-title">
        <div className="welcome-brand">
          <div className="paint-icon" aria-hidden="true">P</div>
          <div>
            <p className="eyebrow">OBJECT GRAPHICS EDITOR</p>
            <h1 id="welcome-title">Welcome to paintSMYS</h1>
          </div>
        </div>
        <div className="welcome-actions" aria-label="Project actions">
          <button className="win95-button welcome-action" type="button" onClick={onNewProject} disabled={busy}>
            <span className="action-icon action-icon--new" aria-hidden="true">✚</span>
            <span><strong>New Project</strong><small>Start with a blank Artboard</small></span>
            <span className="action-arrow" aria-hidden="true">›</span>
          </button>
          <button className="win95-button welcome-action" type="button" onClick={onOpenProject} disabled={busy}>
            <span className="action-icon action-icon--open" aria-hidden="true">▰</span>
            <span><strong>{busy ? 'Opening Project…' : 'Open Project'}</strong><small>Open a project folder from this device</small></span>
            <span className="action-arrow" aria-hidden="true">›</span>
          </button>
        </div>
        {error && <p className="startup-message startup-message--error" role="alert">{error}</p>}
        <p className="welcome-footer">A small canvas for big ideas.</p>
      </section>
    </main>
  )
}

export default WelcomeScreen
