import assert from 'node:assert/strict'
import { DocumentHistory } from '../src/application/document-history'
import { getPngFileName, MAX_PNG_EXPORT_BYTES } from '../src/application/export-png-port'
import { exportPngFile, validatePngBytes } from '../src/app/desktop/png-export'
import { addRectangle, addTextObject, createSceneDocument, type SceneDocument } from '../src/core/document/scene-document'
import { setTextRuns } from '../src/core/document/scene-document'
import { createProjectManifest, parseProjectManifest, serializeProjectManifest } from '../src/core/project/project-manifest'
import { openProjectSession } from '../src/application/project-session'
import { renderSceneSvg } from '../src/editor/workspace/scene-svg-serialization'

function makeScene(): SceneDocument {
  const empty = createSceneDocument(1920, 1080)
  const withBackground = { ...empty, artboard: { ...empty.artboard, backgroundColor: '#e0f0ff' } }
  const withRectangle = addRectangle(withBackground, { x: 40, y: 50, width: 240, height: 120 })
  const rectangle = withRectangle.objects[0]
  if (rectangle.type !== 'rectangle') throw new Error('Expected a rectangle.')
  rectangle.fill = '#ff0000'
  rectangle.stroke = '#102030'
  rectangle.strokeWidth = 3
  return addTextObject(withRectangle, {
    x: 52,
    y: 62,
    text: '  Русский <Paint> & café  \n\n  English  ',
    fontFamily: 'Courier New',
    fontSize: 20,
    color: '#123456',
  })
}

function makePngHeader(width: number, height: number): Uint8Array<ArrayBuffer> {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  const encodeChunk = (type: string, data: number[] = []) => [
    0, 0, 0, data.length,
    ...Array.from(type, (character) => character.charCodeAt(0)),
    ...data,
    0, 0, 0, 0,
  ]
  const ihdrData = [
    (width >>> 24) & 255, (width >>> 16) & 255, (width >>> 8) & 255, width & 255,
    (height >>> 24) & 255, (height >>> 16) & 255, (height >>> 8) & 255, height & 255,
    8, 6, 0, 0, 0,
  ]
  return Uint8Array.from([
    ...signature,
    ...encodeChunk('IHDR', ihdrData),
    ...encodeChunk('IDAT', [1]),
    ...encodeChunk('IEND'),
  ])
}

const scene = makeScene()
const originalScene = JSON.stringify(scene)
const svg = renderSceneSvg(scene)

assert.match(svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
assert.match(svg, /width="1920" height="1080" viewBox="0 0 1920 1080"/)
assert.match(svg, /<rect width="1920" height="1080" fill="#e0f0ff"><\/rect>/)
assert.match(svg, /x="40" y="50" width="240" height="120" fill="#ff0000" stroke="#102030" stroke-width="3"><\/rect>/)
assert.match(svg, /font-family="Courier New, monospace" font-size="20" fill="#123456" xml:space="preserve"/)
assert.match(svg, /<tspan x="52" y="82">  Русский &lt;Paint&gt; &amp; café  <\/tspan>/)
assert.match(svg, /<tspan x="52" y="106"> <\/tspan>/)
assert.match(svg, /<tspan x="52" y="130">  English  <\/tspan>/)
assert.ok(svg.indexOf('fill="#ff0000"') < svg.indexOf('font-family="Courier New, monospace"'))
assert.doesNotMatch(svg, /stroke-dasharray|vector-effect|fill-opacity|class="scene-svg|checkerboard|selection/i)
assert.equal(JSON.stringify(scene), originalScene, 'serializing the scene must not mutate the document')

const styledSource = '  result = subprocess.run(\n    ["grim", "-o", output],\n    check=True\n)\n\nПривет 😀  <Paint> &  '
const styledStart = styledSource.indexOf('result')
const styledEnd = styledSource.indexOf('check=True') + 'check=True'.length
let styledScene = addTextObject(createSceneDocument(640, 400), {
  x: 12,
  y: 14,
  text: styledSource,
})
const styledObject = styledScene.objects[0]
if (styledObject.type !== 'text') throw new Error('Expected a text object.')
styledScene = setTextRuns(styledScene, styledObject.id, [
  { start: styledStart, end: styledEnd, color: '#c00000' },
  { start: styledSource.indexOf('Привет'), end: styledSource.length - 2, color: '#008000' },
])

const projectJson = serializeProjectManifest(createProjectManifest('styled-project', 'Styled Text', styledScene))
assert.doesNotMatch(projectJson, /<\/?tspan|<text/i, 'project.json must store source text and ranges, not SVG markup')
const reopened = openProjectSession(projectJson, '/styled-project')
const reopenedText = reopened.document.objects[0]
if (reopenedText.type !== 'text') throw new Error('Expected the opened object to remain text.')
assert.equal(reopenedText.text, styledSource)
assert.deepEqual(reopenedText.runs, [
  { start: styledStart, end: styledEnd, color: '#c00000' },
  { start: styledSource.indexOf('Привет'), end: styledSource.length - 2, color: '#008000' },
])
assert.equal(parseProjectManifest(projectJson).scene.objects.length, 1, 'styled text stays one scene object')
assert.equal(serializeProjectManifest(parseProjectManifest(projectJson)), projectJson, 'a second Save preserves styled source and ranges')

const styledSvg = renderSceneSvg(reopened.document)
assert.equal((styledSvg.match(/<text\b/g) ?? []).length, 1, 'all colored fragments stay in one logical text block')
assert.match(styledSvg, /<svg[^>]*width="640" height="400" viewBox="0 0 640 400"/)
assert.deepEqual(
  [...styledSvg.matchAll(/<tspan x="12" y="(\d+)">/g)].map((match) => Number(match[1])),
  [34, 58, 82, 106, 130, 154],
  'each line, including the blank line, keeps the original baseline spacing',
)
assert.match(styledSvg, /<tspan fill="#c00000">result = subprocess\.run\(/)
assert.match(styledSvg, /<tspan fill="#008000">Привет 😀/)
assert.match(styledSvg, /    \[&quot;grim&quot;, &quot;-o&quot;, output\],/)
assert.match(styledSvg, /<tspan x="12" y="130"> <\/tspan>/)
assert.match(styledSvg, /&lt;Paint&gt; &amp;/, 'styled text content is escaped instead of becoming SVG markup')
assert.match(styledSvg, /&amp;<\/tspan><tspan>  <\/tspan>/, 'trailing spaces remain after the colored fragment')

const savedScene = createSceneDocument(1920, 1080)
const history = new DocumentHistory(savedScene)
assert.equal(history.recordChange(savedScene, scene), true)
assert.equal(history.isDirty(scene), true)
assert.equal(history.canUndo, true)
assert.equal(history.canRedo, false)
renderSceneSvg(scene)
assert.equal(history.isDirty(scene), true, 'rendering for export must leave the dirty state unchanged')
assert.equal(history.canUndo, true, 'rendering for export must not add or remove history entries')
assert.equal(history.canRedo, false)

assert.equal(getPngFileName('Пример проекта'), 'Пример проекта.png')
assert.equal(getPngFileName('Artwork.PNG'), 'Artwork.PNG')
assert.equal(getPngFileName('../Artwork'), '..-Artwork.png')
assert.equal(getPngFileName('CON'), 'Untitled.png')

const validPng = makePngHeader(1920, 1080)
assert.equal(validatePngBytes(validPng).valid, true)
assert.equal(validatePngBytes(makePngHeader(16_385, 2)).valid, false)
assert.equal(validatePngBytes(new Uint8Array([1, 2, 3])).valid, false)
const oversizedPng = Object.create(Uint8Array.prototype) as Uint8Array
Object.defineProperty(oversizedPng, 'byteLength', { value: MAX_PNG_EXPORT_BYTES + 1 })
assert.equal(validatePngBytes(oversizedPng).valid, false)

async function testDesktopDialogAndWriteResults() {
  let writeCount = 0
  const request = { projectName: 'Scene', pngBytes: validPng }
  const cancelled = await exportPngFile(request, async (name) => {
    assert.equal(name, 'Scene.png')
    return null
  }, async () => { writeCount += 1 })
  assert.deepEqual(cancelled, { status: 'cancelled' })
  assert.equal(writeCount, 0, 'cancelling the native dialog must not write a file')

  const failedWrite = await exportPngFile(
    request,
    async () => '/chosen/scene.png',
    async () => { throw new Error('Disk is full.') },
  )
  assert.deepEqual(failedWrite, { status: 'error', message: 'Disk is full.' })
}

void testDesktopDialogAndWriteResults().then(() => {
  console.log('PNG export rendering and payload checks passed')
})
