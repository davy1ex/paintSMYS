import { useEffect, useRef, useState, type MouseEvent } from 'react'

export type PaintColorChannel = 'foreground' | 'background'

export const CLASSIC_PAINT_COLORS = [
  '#000000', '#808080', '#800000', '#ff0000', '#808000', '#ffff00', '#008000',
  '#00ff00', '#008080', '#00ffff', '#000080', '#0000ff', '#800080', '#ff00ff',
  '#ffffff', '#c0c0c0', '#804000', '#ff8040', '#808040', '#ffff80', '#408000',
  '#80ff00', '#408080', '#80ffff', '#404080', '#8080ff', '#804080', '#ff80ff',
] as const

type ColorPaletteProps = {
  foregroundColor: string
  backgroundColor: string
  onSelectColor: (color: string, channel: PaintColorChannel) => void
}

function isHexColor(value: string): boolean {
  return /^#[\da-f]{6}$/i.test(value)
}

function ColorPalette({ foregroundColor, backgroundColor, onSelectColor }: ColorPaletteProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [customPickerOpen, setCustomPickerOpen] = useState(false)
  const [customChannel, setCustomChannel] = useState<PaintColorChannel>('foreground')
  const [customDraft, setCustomDraft] = useState('#000000')
  const [customHexDraft, setCustomHexDraft] = useState('#000000')
  const [lastCustomColor, setLastCustomColor] = useState<string | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (customPickerOpen && !dialog.open) dialog.showModal()
    if (!customPickerOpen && dialog.open) dialog.close()
  }, [customPickerOpen])

  function openCustomPicker(channel: PaintColorChannel) {
    const current = channel === 'foreground' ? foregroundColor : backgroundColor
    const initialColor = isHexColor(current) ? current : '#000000'
    setCustomChannel(channel)
    setCustomDraft(initialColor)
    setCustomHexDraft(initialColor)
    setCustomError(null)
    setCustomPickerOpen(true)
  }

  function handleSwatchContextMenu(event: MouseEvent<HTMLButtonElement>, color: string) {
    event.preventDefault()
    onSelectColor(color, 'background')
  }

  function applyCustomColor() {
    const color = customHexDraft.trim().toLowerCase()
    if (!isHexColor(color)) {
      setCustomError('Enter a color in #RRGGBB format.')
      return
    }
    setLastCustomColor(color)
    onSelectColor(color, customChannel)
    setCustomPickerOpen(false)
  }

  return (
    <section
      className="editor-color-palette"
      aria-label="Color palette"
      title="Left-click a color for text and rectangle stroke; right-click for rectangle fill."
    >
      <div className="editor-color-palette__current" aria-label="Current Paint colors">
        <span className="editor-color-palette__current-label">COLOR</span>
        <span
          className="editor-color-palette__background-color"
          style={{ backgroundColor: backgroundColor === 'transparent' ? '#ffffff' : backgroundColor }}
          aria-label={`Background color ${backgroundColor}`}
          title={`Background / rectangle fill: ${backgroundColor}`}
        />
        <span
          className="editor-color-palette__foreground-color"
          style={{ backgroundColor: foregroundColor === 'transparent' ? '#ffffff' : foregroundColor }}
          aria-label={`Foreground color ${foregroundColor}`}
          title={`Foreground / text and rectangle stroke: ${foregroundColor}`}
        />
      </div>

      <div className="editor-color-palette__swatches" role="group" aria-label="Classic Paint colors">
        {CLASSIC_PAINT_COLORS.map((color) => (
          <button
            className={`editor-color-palette__swatch${foregroundColor.toLowerCase() === color ? ' editor-color-palette__swatch--foreground' : ''}${backgroundColor.toLowerCase() === color ? ' editor-color-palette__swatch--background' : ''}`}
            key={color}
            type="button"
            data-palette-color={color}
            aria-label={`Color ${color}; left-click for foreground, right-click for background`}
            aria-pressed={foregroundColor.toLowerCase() === color || backgroundColor.toLowerCase() === color}
            title={`${color} — left-click: text/stroke, right-click: fill`}
            style={{ backgroundColor: color }}
            onClick={() => onSelectColor(color, 'foreground')}
            onContextMenu={(event) => handleSwatchContextMenu(event, color)}
          />
        ))}
      </div>

      <button
        className="editor-color-palette__custom"
        type="button"
        aria-label="Choose custom color"
        title="Choose a custom color. Right-click this button to choose the rectangle fill color."
        onClick={() => openCustomPicker('foreground')}
        onContextMenu={(event) => {
          event.preventDefault()
          openCustomPicker('background')
        }}
      >
        <span
          className={`editor-color-palette__custom-swatch${lastCustomColor ? '' : ' editor-color-palette__custom-swatch--rainbow'}`}
          style={lastCustomColor ? { backgroundColor: lastCustomColor } : undefined}
          aria-hidden="true"
        />
        <span>Custom</span>
      </button>

      <dialog
        ref={dialogRef}
        className="editor-color-dialog"
        aria-labelledby="editor-color-dialog-title"
        onCancel={(event) => {
          event.preventDefault()
          setCustomPickerOpen(false)
        }}
        onClose={() => setCustomPickerOpen(false)}
        onSubmit={(event) => {
          event.preventDefault()
          applyCustomColor()
        }}
      >
        <div className="editor-color-dialog__titlebar" id="editor-color-dialog-title">Custom Color</div>
        <div className="editor-color-dialog__body">
          <label className="editor-color-dialog__picker-label">
            Pick a color
            <input
              aria-label="Custom color picker"
              type="color"
              value={customDraft}
              onChange={(event) => {
                setCustomDraft(event.currentTarget.value)
                setCustomHexDraft(event.currentTarget.value)
                setCustomError(null)
              }}
            />
          </label>
          <label className="editor-color-dialog__hex-label">
            HEX
            <input
              aria-label="Custom color HEX"
              autoFocus
              maxLength={7}
              spellCheck={false}
              value={customHexDraft}
              onChange={(event) => {
                const value = event.currentTarget.value
                setCustomHexDraft(value)
                if (isHexColor(value)) setCustomDraft(value.toLowerCase())
                setCustomError(null)
              }}
            />
          </label>
          <fieldset className="editor-color-dialog__target">
            <legend>Apply to</legend>
            <label>
              <input type="radio" name="custom-color-channel" value="foreground" checked={customChannel === 'foreground'} onChange={() => setCustomChannel('foreground')} />
              Text / rectangle stroke
            </label>
            <label>
              <input type="radio" name="custom-color-channel" value="background" checked={customChannel === 'background'} onChange={() => setCustomChannel('background')} />
              Rectangle fill
            </label>
          </fieldset>
          {customError && <span className="editor-color-dialog__error" role="alert">{customError}</span>}
          <div className="editor-color-dialog__actions">
            <button className="win95-button" type="button" onClick={() => setCustomPickerOpen(false)}>Cancel</button>
            <button className="win95-button win95-button--primary" type="button" onClick={applyCustomColor}>OK</button>
          </div>
        </div>
      </dialog>
    </section>
  )
}

export default ColorPalette
