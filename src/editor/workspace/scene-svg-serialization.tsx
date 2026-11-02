import { renderToStaticMarkup } from 'react-dom/server'
import type { SceneDocument } from '../../core/document/scene-document'
import { SceneSvgContent } from './SceneSvgContent'

/** Serialize the same scene content used by the editor as a self-contained SVG. */
export function renderSceneSvg(document: SceneDocument): string {
  const { width, height } = document.artboard

  return renderToStaticMarkup(
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="hidden"
    >
      <SceneSvgContent document={document} />
    </svg>,
  )
}
