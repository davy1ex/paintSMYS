import { mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import {
  MAX_PLUGIN_MANIFEST_BYTES,
  MAX_PLUGIN_SOURCE_BYTES,
  parsePluginManifestText,
  type LoadedPlugin,
  type PluginCatalog,
} from '../../application/plugins/plugin-api'

function isWithin(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child)
  return pathFromParent === '' || (pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
}

async function readBoundedFile(path: string, maxBytes: number, label: string): Promise<string> {
  const fileInfo = await stat(path)
  if (!fileInfo.isFile() || fileInfo.size > maxBytes) {
    throw new Error(`${label} must be a file no larger than ${maxBytes.toLocaleString()} bytes.`)
  }
  return readFile(path, 'utf8')
}

/** Read trusted local packages without importing or evaluating their source. */
export async function loadInstalledPlugins(pluginRoot: string): Promise<PluginCatalog> {
  const plugins: LoadedPlugin[] = []
  const errors: string[] = []
  const seenPluginIds = new Set<string>()

  try {
    await mkdir(pluginRoot, { recursive: true })
    const pluginsRoot = await realpath(pluginRoot)
    const entries = await readdir(pluginsRoot, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      let folderLabel = entry.name.replace(/[\u0000-\u001f]/g, '').slice(0, 80) || 'Plugin folder'
      try {
        const packagePath = await realpath(join(pluginsRoot, entry.name))
        if (!isWithin(pluginsRoot, packagePath)) throw new Error('The plugin folder resolves outside the plugin directory.')

        const manifestPath = await realpath(join(packagePath, 'manifest.json'))
        if (!isWithin(packagePath, manifestPath)) throw new Error('manifest.json resolves outside its package folder.')
        const manifestText = await readBoundedFile(manifestPath, MAX_PLUGIN_MANIFEST_BYTES, 'manifest.json')
        const manifest = parsePluginManifestText(manifestText)
        folderLabel = manifest.name
        if (seenPluginIds.has(manifest.id)) throw new Error(`Plugin ID "${manifest.id}" is already installed.`)

        const entryPath = await realpath(join(packagePath, ...manifest.entry.split('/')))
        if (!isWithin(packagePath, entryPath)) throw new Error('The plugin entry point resolves outside its package folder.')
        const source = await readBoundedFile(entryPath, MAX_PLUGIN_SOURCE_BYTES, manifest.entry)
        plugins.push({ manifest, source })
        seenPluginIds.add(manifest.id)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The plugin could not be loaded.'
        errors.push(`${folderLabel}: ${message}`.slice(0, 400))
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The plugin folder could not be read.'
    errors.push(`Plugins: ${message}`.slice(0, 400))
  }

  return { plugins, errors }
}
