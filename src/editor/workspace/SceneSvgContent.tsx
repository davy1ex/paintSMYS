import type { SceneDocument, TextStyleRun } from '../../core/document/scene-document'

export type ScenePositionPreview = {
  objectId: string
  x: number
  y: number
}

type SceneSvgContentProps = {
  document: SceneDocument
  positionPreview?: ScenePositionPreview | null
}

type TextSegment = { text: string; color?: string }

function getLineSegments(line: string, lineStart: number, runs: TextStyleRun[]): TextSegment[] {
  const lineEnd = lineStart + line.length
  const segments: TextSegment[] = []
  let cursor = lineStart

  for (const run of runs) {
    if (run.end <= lineStart || run.start >= lineEnd) continue
    const start = Math.max(run.start, lineStart)
    const end = Math.min(run.end, lineEnd)
    if (start > cursor) segments.push({ text: line.slice(cursor - lineStart, start - lineStart) })
    if (end > start) segments.push({ text: line.slice(start - lineStart, end - lineStart), color: run.color })
    cursor = end
  }

  if (cursor < lineEnd) segments.push({ text: line.slice(cursor - lineStart) })
  return segments
}

/** Shared Artboard background and object rendering for the editor and exports. */
export function SceneSvgContent({ document, positionPreview = null }: SceneSvgContentProps) {
  const { artboard } = document

  return (
    <>
      <rect width={artboard.width} height={artboard.height} fill={artboard.backgroundColor} />
      {document.objects.map((object) => {
        const position = positionPreview?.objectId === object.id ? positionPreview : object
        if (object.type === 'text') {
          const lineHeight = object.fontSize * 1.2
          let lineStart = 0
          return (
            <text
              key={object.id}
              fontFamily={`${object.fontFamily}, monospace`}
              fontSize={object.fontSize}
              fill={object.color}
              xmlSpace="preserve"
              pointerEvents="none"
              aria-label={object.text}
            >
              {object.text.split('\n').map((line, index) => {
                const currentLineStart = lineStart
                lineStart += line.length + 1
                const baseline = position.y + object.fontSize + index * lineHeight
                if (!object.runs?.length) {
                  return (
                    <tspan key={index} x={position.x} y={baseline}>
                      {line || '\u00a0'}
                    </tspan>
                  )
                }

                const segments = getLineSegments(line, currentLineStart, object.runs)
                return (
                  <tspan key={index} x={position.x} y={baseline}>
                    {segments.length === 0
                      ? '\u00a0'
                      : segments.map((segment, segmentIndex) => (
                        <tspan key={segmentIndex} {...(segment.color ? { fill: segment.color } : {})}>
                          {segment.text}
                        </tspan>
                      ))}
                  </tspan>
                )
              })}
            </text>
          )
        }

        return (
          <rect
            key={object.id}
            x={position.x}
            y={position.y}
            width={object.width}
            height={object.height}
            fill={object.fill}
            stroke={object.stroke}
            strokeWidth={object.strokeWidth}
          />
        )
      })}
    </>
  )
}
