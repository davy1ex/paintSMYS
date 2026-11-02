export const MAX_PNG_EXPORT_BYTES = 256 * 1024 * 1024

export type PngExportRequest = {
  projectName: string
  pngBytes: Uint8Array<ArrayBuffer>
}

export type PngExportSelection =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'exported' }

export type PngExportPort = {
  exportPng: (request: PngExportRequest) => Promise<PngExportSelection>
}

/** Produce a portable PNG filename while retaining Unicode project names. */
export function getPngFileName(projectName: string): string {
  const safeName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 180)
  const baseName = safeName || 'Untitled'
  const fileName = /\.png$/i.test(baseName) ? baseName : `${baseName}.png`
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.png)?$/i.test(fileName)) return 'Untitled.png'
  return fileName
}
