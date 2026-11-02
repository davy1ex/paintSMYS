type ToolName = 'select' | 'rectangle'

type ToolPanelProps = {
  activeTool: ToolName
  onToolChange: (tool: ToolName) => void
}

function ToolIcon({ tool }: { tool: ToolName }) {
  if (tool === 'select') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
        <rect x="3" y="3" width="14" height="13" fill="none" stroke="#111" strokeDasharray="2 2" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <rect x="3.5" y="4.5" width="13" height="11" fill="none" stroke="#111" />
      <path d="M5 6h10v8H5z" fill="none" stroke="#fff" />
    </svg>
  )
}

function ToolPanel({ activeTool, onToolChange }: ToolPanelProps) {
  const tools: { name: ToolName; label: string }[] = [
    { name: 'select', label: 'Select' },
    { name: 'rectangle', label: 'Rectangle' },
  ]

  return (
    <aside className="tool-panel" aria-label="Tool Panel">
      <div className="tool-panel__grid">
        {tools.map(({ name, label }) => (
          <button
            key={name}
            className="tool-panel__button"
            type="button"
            aria-label={label}
            aria-pressed={activeTool === name}
            title={label}
            onClick={() => onToolChange(name)}
          >
            <ToolIcon tool={name} />
          </button>
        ))}
      </div>
    </aside>
  )
}

export default ToolPanel
