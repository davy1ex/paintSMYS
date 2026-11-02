import type { SceneDocument } from '../../core/document/scene-document'

export type ScenePositionPreview = {
  objectId: string
  x: number
  y: number
}

type SceneSvgContentProps = {
  document: SceneDocument
  positionPreview?: ScenePositionPreview | null
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
              {object.text.split('\n').map((line, index) => (
                <tspan key={index} x={position.x} y={position.y + object.fontSize + index * lineHeight}>
                  {line || '\u00a0'}
                </tspan>
              ))}
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
