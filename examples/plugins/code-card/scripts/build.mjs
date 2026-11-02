import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { build } from 'esbuild'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const pluginDirectory = resolve(scriptDirectory, '..')

const outputPath = resolve(pluginDirectory, 'index.js')
const result = await build({
  entryPoints: [resolve(pluginDirectory, 'src/index.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  write: false,
})

const bundle = result.outputFiles[0]
const sourceLimit = 768 * 1024
if (!bundle || bundle.contents.byteLength > sourceLimit) {
  throw new Error(`The Code Card bundle must fit the ${sourceLimit}-byte plugin source limit.`)
}
await writeFile(outputPath, bundle.contents)
console.log(`Built ${outputPath} (${bundle.contents.byteLength} bytes).`)
