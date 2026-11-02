type ToolName = 'select' | 'rectangle' | 'text'

type ToolPanelProps = {
  activeTool: ToolName
  onToolChange: (tool: ToolName) => void
}

function ToolIcon({ tool }: { tool: ToolName }) {
  if (tool === 'select') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
        <path d="M10 1v18M1 10h18M10 1 7 4M10 1l3 3M19 10l-3-3M19 10l-3 3M10 19l-3-3M10 19l3-3M1 10l3-3M1 10l3 3" fill="none" stroke="#111" />
        <path d="M10 2v4M18 10h-4M10 18v-4M2 10h4" fill="none" stroke="#fff" />
        <rect x="7" y="7" width="6" height="6" fill="#c0c0c0" stroke="#111" />
      </svg>
    )
  }

  if (tool === 'rectangle') return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <rect x="3.5" y="4.5" width="13" height="11" fill="none" stroke="#111" />
      <path d="M5 6h10v8H5z" fill="none" stroke="#fff" />
    </svg>
  )

  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" shapeRendering="crispEdges">
      <path d="M3 3h14v3h-5v11H8V6H3z" fill="#111" />
      <path d="M4 4h12v1H4zM9 6h2v10H9z" fill="#fff" />
    </svg>
  )
}

function ToolPanel({ activeTool, onToolChange }: ToolPanelProps) {
  const tools: { name: ToolName; label: string }[] = [
    { name: 'select', label: 'Select / Move' },
    { name: 'rectangle', label: 'Rectangle' },
    { name: 'text', label: 'Text' },
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
