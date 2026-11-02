import {
  MAX_ARTBOARD_DIMENSION,
  MAX_ARTBOARD_PIXELS,
} from '../../core/document/scene-document'
import {
  getPngFileName,
  MAX_PNG_EXPORT_BYTES,
  type PngExportRequest,
  type PngExportSelection,
} from '../../application/export-png-port'

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** Validate the bounded PNG payload received over the narrow Desktop export IPC. */
export function validatePngBytes(value: unknown): { valid: true } | { valid: false; message: string } {
  if (!(value instanceof Uint8Array)) {
    return { valid: false, message: 'The PNG data is invalid.' }
  }
  if (value.byteLength > MAX_PNG_EXPORT_BYTES) {
    return { valid: false, message: 'The PNG is larger than the 256 MB export limit.' }
  }
  if (value.byteLength < 45 || !PNG_SIGNATURE.every((byte, index) => value[index] === byte)) {
    return { valid: false, message: 'The PNG data is incomplete or has an invalid file signature.' }
  }

  const view = new DataView(value.buffer, value.byteOffset, value.byteLength)
  if (view.getUint32(8) !== 13 || String.fromCharCode(...value.subarray(12, 16)) !== 'IHDR') {
    return { valid: false, message: 'The PNG data does not contain a valid image header.' }
  }

  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (
    width <= 0 || height <= 0 || width > MAX_ARTBOARD_DIMENSION || height > MAX_ARTBOARD_DIMENSION ||
    width * height > MAX_ARTBOARD_PIXELS
  ) {
    return { valid: false, message: 'The PNG dimensions exceed the supported Artboard limits.' }
  }

  let offset = 8
  let hasImageData = false
  let hasEnd = false
  while (offset < value.byteLength) {
    if (offset + 12 > value.byteLength) {
      return { valid: false, message: 'The PNG data contains an incomplete chunk.' }
    }
    const chunkLength = view.getUint32(offset)
    if (chunkLength > value.byteLength - offset - 12) {
      return { valid: false, message: 'The PNG data contains an incomplete chunk.' }
    }
    const chunkType = String.fromCharCode(...value.subarray(offset + 4, offset + 8))
    if (offset === 8 && (chunkType !== 'IHDR' || chunkLength !== 13)) {
      return { valid: false, message: 'The PNG data does not start with a valid image header.' }
    }
    if (chunkType === 'IDAT') hasImageData = true
    offset += chunkLength + 12
    if (chunkType === 'IEND') {
      hasEnd = chunkLength === 0 && offset === value.byteLength
      break
    }
  }

  if (!hasImageData || !hasEnd) {
    return { valid: false, message: 'The PNG data is missing image data or its end marker.' }
  }
  return { valid: true }
}

/** Keep dialog cancellation and disk errors explicit while making the flow testable. */
export async function exportPngFile(
  request: PngExportRequest,
  selectFilePath: (defaultName: string) => Promise<string | null>,
  writePng: (filePath: string, bytes: Uint8Array) => Promise<void>,
): Promise<PngExportSelection> {
  const validation = validatePngBytes(request.pngBytes)
  if (!validation.valid) return { status: 'error', message: validation.message }

  try {
    const filePath = await selectFilePath(getPngFileName(request.projectName))
    if (!filePath) return { status: 'cancelled' }
    await writePng(filePath, request.pngBytes)
    return { status: 'exported' }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'The PNG file could not be written.',
    }
  }
}
