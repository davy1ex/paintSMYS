import {
  MAX_ARTBOARD_DIMENSION,
  MAX_ARTBOARD_PIXELS,
  type SceneDocument,
} from '../../core/document/scene-document'
import { MAX_PNG_EXPORT_BYTES } from '../../application/export-png-port'
import { renderSceneSvg } from './scene-svg-serialization'

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not create a PNG for this Artboard. Try a smaller Artboard.'))
    }, 'image/png')
  })
}

function validateExportDimensions(document: SceneDocument): void {
  const { width, height } = document.artboard
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > MAX_ARTBOARD_DIMENSION || height > MAX_ARTBOARD_DIMENSION ||
    width * height > MAX_ARTBOARD_PIXELS
  ) {
    throw new Error('The Artboard dimensions are too large to export as PNG.')
  }
}

/** Rasterize a self-contained scene SVG at the Artboard's native pixel dimensions. */
export async function createScenePngBlob(scene: SceneDocument): Promise<Blob> {
  validateExportDimensions(scene)

  let svgUrl: string | null = null
  let canvas: HTMLCanvasElement | null = null
  const image = new Image()
  try {
    const svgBlob = new Blob([renderSceneSvg(scene)], { type: 'image/svg+xml;charset=utf-8' })
    svgUrl = URL.createObjectURL(svgBlob)
    image.src = svgUrl
    await image.decode()

    canvas = globalThis.document.createElement('canvas')
    canvas.width = scene.artboard.width
    canvas.height = scene.artboard.height
    if (canvas.width !== scene.artboard.width || canvas.height !== scene.artboard.height) {
      throw new Error('The browser cannot create a canvas at this Artboard size. Try a smaller Artboard.')
    }

    const context = canvas.getContext('2d')
    if (!context) throw new Error('The browser could not create a canvas for PNG export.')
    context.drawImage(image, 0, 0, scene.artboard.width, scene.artboard.height)

    const png = await canvasToPng(canvas)
    if (png.size > MAX_PNG_EXPORT_BYTES) {
      throw new Error('The PNG is too large to export. Try a smaller Artboard.')
    }
    return png
  } catch (error) {
    if (error instanceof Error && /PNG|canvas|Artboard|browser/i.test(error.message)) throw error
    throw new Error('The Artboard could not be rendered as PNG. Try a smaller Artboard or close other applications.')
  } finally {
    image.src = ''
    if (svgUrl) URL.revokeObjectURL(svgUrl)
    if (canvas) {
      canvas.width = 0
      canvas.height = 0
    }
  }
}
