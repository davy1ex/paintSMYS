import { useState, type FormEvent } from 'react'

export const PROJECT_PRESETS = [
  { name: 'Full HD', width: 1920, height: 1080 },
  { name: 'HD', width: 1280, height: 720 },
  { name: '4K', width: 3840, height: 2160 },
  { name: 'Vertical', width: 1080, height: 1920 },
  { name: 'Square', width: 1080, height: 1080 },
] as const

type NewProjectScreenProps = {
  error: string | null
  onBack: () => void
  onCreate: (width: number, height: number) => void
}

function NewProjectScreen({ error, onBack, onCreate }: NewProjectScreenProps) {
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [customError, setCustomError] = useState<string | null>(null)

  function submitCustom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedWidth = Number(width)
    const parsedHeight = Number(height)
    if (!Number.isInteger(parsedWidth) || !Number.isInteger(parsedHeight) || parsedWidth <= 0 || parsedHeight <= 0) {
      setCustomError('Enter positive whole numbers for both dimensions.')
      return
    }
    try {
      onCreate(parsedWidth, parsedHeight)
    } catch (submitError) {
      setCustomError(submitError instanceof Error ? submitError.message : 'The Artboard could not be created.')
    }
  }

  return (
    <main className="startup-window">
      <div className="startup-titlebar">
        <span className="startup-titlebar__icon" aria-hidden="true">P</span>
        <span>paintSMYS — New Project</span>
      </div>
      <section className="new-project-screen" aria-labelledby="new-project-title">
        <div className="screen-heading">
          <button className="win95-button back-button" type="button" onClick={onBack} aria-label="Back to Welcome">‹</button>
          <div>
            <p className="eyebrow">NEW PROJECT</p>
            <h1 id="new-project-title">Choose an Artboard size</h1>
          </div>
        </div>
        <div className="preset-grid" aria-label="Artboard presets">
          {PROJECT_PRESETS.map((preset) => (
            <button
              className="win95-button preset-tile"
              key={preset.name}
              type="button"
              onClick={() => onCreate(preset.width, preset.height)}
            >
              <span className="preset-preview" aria-hidden="true" style={{ aspectRatio: `${preset.width} / ${preset.height}` }} />
              <span className="preset-copy"><strong>{preset.name}</strong><small>{preset.width} × {preset.height} px</small></span>
              <span className="preset-enter" aria-hidden="true">↵</span>
            </button>
          ))}
          <section className="preset-tile preset-tile--custom" role="group" aria-labelledby="custom-preset-title">
            <div className="custom-preset-heading">
              <span className="preset-preview preset-preview--custom" aria-hidden="true">＋</span>
              <span className="preset-copy"><strong id="custom-preset-title">Custom</strong><small>User-defined size</small></span>
            </div>
            <form className="custom-inline-form" onSubmit={submitCustom}>
              <label><span>Width (px)</span><input autoFocus autoComplete="off" type="number" min="1" step="1" required value={width} onChange={(event) => { setWidth(event.target.value); setCustomError(null) }} /></label>
              <label><span>Height (px)</span><input autoComplete="off" type="number" min="1" step="1" required value={height} onChange={(event) => { setHeight(event.target.value); setCustomError(null) }} /></label>
              <button className="win95-button win95-button--primary custom-inline-create" type="submit">Create</button>
            </form>
            {(customError || error) && <p className="startup-message startup-message--error custom-inline-error" role="alert">{customError || error}</p>}
          </section>
        </div>
        {error && <p className="startup-message startup-message--error" role="alert">{error}</p>}
        <p className="new-project-note"><span aria-hidden="true">▧</span> Every new Artboard starts with a white background.</p>
      </section>

    </main>
  )
}

export default NewProjectScreen
