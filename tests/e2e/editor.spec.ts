import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'

const browserErrors = new WeakMap<Page, string[]>()

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  browserErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack ?? error.message}`))
})

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return
  const errors = browserErrors.get(page) ?? []
  if (errors.length > 0) {
    await testInfo.attach('browser-console-errors', {
      body: errors.join('\n'),
      contentType: 'text/plain',
    })
  }
})

async function createArtboard(page: Page, width: number, height: number) {
  await page.goto('/')
  await page.getByRole('button', { name: /New Project/ }).click()
  await page.getByLabel('Width (px)').fill(String(width))
  await page.getByLabel('Height (px)').fill(String(height))
  await page.getByRole('button', { name: 'Create', exact: true }).click()

  const svg = page.getByRole('img', { name: 'Scene contents' })
  await expect(svg).toBeVisible()
  await expect.poll(async () => (await svg.boundingBox())?.width ?? 0).toBeGreaterThan(0)
  return svg
}

async function dragOnArtboard(
  page: Page,
  svg: Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const box = await svg.boundingBox()
  if (!box) throw new Error('The Artboard SVG is not visible.')
  await page.mouse.move(box.x + box.width * from.x, box.y + box.height * from.y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * to.x, box.y + box.height * to.y, { steps: 4 })
  await page.mouse.up()
}

test('draw, move, Undo and Redo a Rectangle through the editor', async ({ page }) => {
  const svg = await createArtboard(page, 320, 240)
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await dragOnArtboard(page, svg, { x: 0.2, y: 0.2 }, { x: 0.55, y: 0.55 })

  const rectangles = svg.locator(':scope > rect')
  await expect(rectangles).toHaveCount(2)
  const rectangle = rectangles.nth(1)
  await expect(rectangle).toBeVisible()
  const original = {
    x: await rectangle.getAttribute('x'),
    y: await rectangle.getAttribute('y'),
    width: await rectangle.getAttribute('width'),
    height: await rectangle.getAttribute('height'),
  }
  expect(Number(original.width)).toBeGreaterThan(0)
  expect(Number(original.height)).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Select / Move' }).click()
  const artboard = await svg.boundingBox()
  if (!artboard) throw new Error('The Artboard SVG is not visible.')
  await page.mouse.move(artboard.x + artboard.width * 0.35, artboard.y + artboard.height * 0.35)
  await page.mouse.down()
  await page.mouse.move(artboard.x + artboard.width * 0.42, artboard.y + artboard.height * 0.4, { steps: 4 })
  await page.mouse.up()

  await expect.poll(async () => Number(await rectangle.getAttribute('x'))).toBeGreaterThan(Number(original.x))
  await expect.poll(async () => Number(await rectangle.getAttribute('y'))).toBeGreaterThan(Number(original.y))
  const moved = {
    x: await rectangle.getAttribute('x'),
    y: await rectangle.getAttribute('y'),
  }

  await page.keyboard.press('Control+z')
  await expect.poll(() => rectangle.getAttribute('x')).toBe(original.x)
  await expect.poll(() => rectangle.getAttribute('y')).toBe(original.y)

  await page.keyboard.press('Control+y')
  await expect.poll(() => rectangle.getAttribute('x')).toBe(moved.x)
  await expect.poll(() => rectangle.getAttribute('y')).toBe(moved.y)
})

test('Ctrl+Wheel zooms toward the pointer and respects the zoom limits', async ({ page }) => {
  const svg = await createArtboard(page, 600, 400)
  const zoomLevel = page.getByLabel('Zoom level')
  await expect(zoomLevel).toHaveText(/\d+%/)

  const initial = await svg.boundingBox()
  if (!initial) throw new Error('The Artboard SVG is not visible.')
  const initialDevicePixelRatio = await page.evaluate(() => window.devicePixelRatio)
  const anchor = { x: initial.x + initial.width * 0.31, y: initial.y + initial.height * 0.42 }
  await page.keyboard.down('Control')
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => Number((await zoomLevel.textContent())?.replace('%', ''))).toBeGreaterThan(100)

  const zoomed = await svg.boundingBox()
  if (!zoomed) throw new Error('The zoomed Artboard SVG is not visible.')
  const scenePoint = { x: initial.width * 0.31, y: initial.height * 0.42 }
  expect(zoomed.x + scenePoint.x * zoomed.width / 600).toBeCloseTo(anchor.x, 0)
  expect(zoomed.y + scenePoint.y * zoomed.height / 400).toBeCloseTo(anchor.y, 0)

  await page.mouse.wheel(0, 120)
  await expect.poll(async () => Number((await zoomLevel.textContent())?.replace('%', ''))).toBeLessThan(200)
  for (let step = 0; step < 20; step += 1) await page.mouse.wheel(0, -120)
  await expect.poll(async () => Number((await zoomLevel.textContent())?.replace('%', ''))).toBe(800)
  for (let step = 0; step < 40; step += 1) await page.mouse.wheel(0, 120)
  await expect.poll(async () => Number((await zoomLevel.textContent())?.replace('%', ''))).toBe(10)
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(initialDevicePixelRatio)
  await page.keyboard.up('Control')
})

test('zoom controls set real scale and Fit follows workspace resizing', async ({ page }) => {
  const svg = await createArtboard(page, 1800, 1000)
  const zoomLevel = page.getByLabel('Zoom level')
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  const zoomOut = page.getByRole('button', { name: 'Zoom out' })

  const before = await svg.boundingBox()
  if (!before) throw new Error('The Artboard SVG is not visible.')
  await zoomIn.click()
  const larger = await svg.boundingBox()
  expect(larger?.width).toBeGreaterThan(before.width)
  await zoomOut.click()

  await page.getByRole('button', { name: '100%' }).click()
  await expect(zoomLevel).toHaveText('100%')
  await expect.poll(async () => (await svg.boundingBox())?.width ?? 0).toBeCloseTo(1800, 0)

  await page.getByRole('button', { name: 'Fit' }).click()
  await expect.poll(async () => Number((await zoomLevel.textContent())?.replace('%', ''))).toBeLessThanOrEqual(100)
  const workspace = await page.getByRole('region', { name: 'Artboard workspace' }).locator('.editor-canvas-wrap').boundingBox()
  const fitted = await svg.boundingBox()
  if (!workspace || !fitted) throw new Error('The Fit workspace or Artboard is not visible.')
  expect(fitted.width).toBeLessThanOrEqual(workspace.width)
  expect(fitted.height).toBeLessThanOrEqual(workspace.height)

  const beforeResize = fitted.width
  await page.setViewportSize({ width: 1050, height: 760 })
  await expect.poll(async () => (await svg.boundingBox())?.width ?? 0).toBeLessThan(beforeResize)
  const resizedWorkspace = await page.locator('.editor-canvas-wrap').boundingBox()
  const resizedBoard = await svg.boundingBox()
  if (!resizedWorkspace || !resizedBoard) throw new Error('The resized Fit workspace is not visible.')
  expect(resizedBoard.width).toBeLessThanOrEqual(resizedWorkspace.width)
  expect(resizedBoard.height).toBeLessThanOrEqual(resizedWorkspace.height)
})

test('draw, pan, select and move at 200% without changing scene geometry during navigation', async ({ page }) => {
  const svg = await createArtboard(page, 1280, 720)
  await page.getByRole('button', { name: '100%' }).click()
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  for (let step = 0; step < 4; step += 1) await zoomIn.click()
  await expect(page.getByLabel('Zoom level')).toHaveText('200%')

  const initialBoard = await svg.boundingBox()
  if (!initialBoard) throw new Error('The 200% Artboard is not visible.')
  const start = { x: initialBoard.x + initialBoard.width / 2 - 60, y: initialBoard.y + initialBoard.height / 2 - 40 }
  const end = { x: start.x + 120, y: start.y + 80 }
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 4 })
  await page.mouse.up()

  const rectangle = svg.locator(':scope > rect').nth(1)
  await expect(rectangle).toBeVisible()
  const geometry = async () => ({
    x: Number(await rectangle.getAttribute('x')),
    y: Number(await rectangle.getAttribute('y')),
    width: Number(await rectangle.getAttribute('width')),
    height: Number(await rectangle.getAttribute('height')),
  })
  const drawn = await geometry()
  expect(drawn.x).toBeCloseTo((start.x - initialBoard.x) / 2, 0)
  expect(drawn.y).toBeCloseTo((start.y - initialBoard.y) / 2, 0)
  expect(drawn.width).toBeCloseTo(60, 0)
  expect(drawn.height).toBeCloseTo(40, 0)

  const projectStateAfterDraw = await page.locator('.editor-project-status').textContent()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Fit' }).click()
  await page.getByRole('button', { name: '100%' }).click()
  for (let step = 0; step < 4; step += 1) await zoomIn.click()
  expect(await geometry()).toEqual(drawn)
  expect(await page.locator('.editor-project-status').textContent()).toBe(projectStateAfterDraw)

  await page.keyboard.press('Control+z')
  await expect(svg.locator(':scope > rect')).toHaveCount(1)
  await page.keyboard.press('Control+y')
  await expect.poll(geometry).toEqual(drawn)

  const workspace = page.locator('.editor-canvas-wrap')
  const beforePan = await svg.boundingBox()
  if (!beforePan) throw new Error('The Artboard is not visible before panning.')
  await page.keyboard.down('Space')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 30, start.y + 20, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  const afterPan = await svg.boundingBox()
  expect(afterPan?.x).toBeCloseTo(beforePan.x + 30, 0)
  expect(afterPan?.y).toBeCloseTo(beforePan.y + 20, 0)
  expect(await geometry()).toEqual(drawn)

  const anchorBounds = await rectangle.boundingBox()
  if (!anchorBounds) throw new Error('The Rectangle is not visible for cursor-anchored zoom after Pan.')
  const anchor = { x: anchorBounds.x + anchorBounds.width / 2, y: anchorBounds.y + anchorBounds.height / 2 }
  await page.keyboard.down('Control')
  await page.mouse.move(anchor.x, anchor.y)
  await page.mouse.wheel(0, -120)
  await expect(page.getByLabel('Zoom level')).toHaveText('240%')
  const anchoredAfterZoom = await rectangle.boundingBox()
  if (!anchoredAfterZoom) throw new Error('The Rectangle is not visible after zooming with Pan.')
  expect(anchoredAfterZoom.x + anchoredAfterZoom.width / 2).toBeCloseTo(anchor.x, 0)
  expect(anchoredAfterZoom.y + anchoredAfterZoom.height / 2).toBeCloseTo(anchor.y, 0)
  await page.mouse.wheel(0, 120)
  await page.keyboard.up('Control')
  await expect(page.getByLabel('Zoom level')).toHaveText('200%')
  expect(await geometry()).toEqual(drawn)

  await page.getByRole('button', { name: 'Select / Move' }).click()
  const rectBox = await rectangle.boundingBox()
  if (!rectBox) throw new Error('The Rectangle is not visible after panning.')
  const rectCenter = { x: rectBox.x + rectBox.width / 2, y: rectBox.y + rectBox.height / 2 }
  await page.mouse.move(rectCenter.x, rectCenter.y)
  await page.mouse.down()
  await page.mouse.move(rectCenter.x + 100, rectCenter.y + 40, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => Number(await rectangle.getAttribute('x'))).toBeCloseTo(drawn.x + 50, 0)
  await expect.poll(async () => Number(await rectangle.getAttribute('y'))).toBeCloseTo(drawn.y + 20, 0)
  const moved = await geometry()

  await page.keyboard.press('Control+z')
  await expect.poll(geometry).toEqual(drawn)
  await page.keyboard.press('Control+y')
  await expect.poll(geometry).toEqual(moved)

  const fillColor = page.getByRole('textbox', { name: 'Fill Color', exact: true })
  await fillColor.fill('#ff0000')
  await fillColor.press('Enter')
  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /Export PNG/ }).click()
  const pngDownload = await exportPromise
  const pngPath = await pngDownload.path()
  if (!pngPath) throw new Error('The navigation export did not produce a PNG file.')
  const pngBytes = await readFile(pngPath)
  expect(pngBytes.readUInt32BE(16)).toBe(1280)
  expect(pngBytes.readUInt32BE(20)).toBe(720)
  const sampledPixel = await page.evaluate(async ({ base64, x, y }) => {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not inspect exported pixels.')
    context.drawImage(image, 0, 0)
    const pixel = [...context.getImageData(x, y, 1, 1).data]
    image.close()
    return pixel
  }, {
    base64: pngBytes.toString('base64'),
    x: Math.floor(moved.x + moved.width / 2),
    y: Math.floor(moved.y + moved.height / 2),
  })
  expect(sampledPixel).toEqual([255, 0, 0, 255])

  await page.getByRole('button', { name: 'Text' }).click()
  const boardForText = await svg.boundingBox()
  const workspaceForText = await workspace.boundingBox()
  if (!boardForText || !workspaceForText) throw new Error('The zoomed workspace is not visible for Text creation.')
  const textPoint = { x: workspaceForText.x + workspaceForText.width / 2 - 200, y: workspaceForText.y + workspaceForText.height / 2 - 150 }
  const expectedTextPosition = {
    x: (textPoint.x - boardForText.x) * 1280 / boardForText.width,
    y: (textPoint.y - boardForText.y) * 720 / boardForText.height,
  }
  await page.mouse.click(textPoint.x, textPoint.y)
  const textDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(textDraft).toBeFocused()
  await page.keyboard.type('Zoom text')
  await page.keyboard.press('Control+Enter')
  const zoomedText = svg.locator('text')
  await expect(zoomedText).toHaveAttribute('aria-label', 'Zoom text')
  const zoomedTextLine = zoomedText.locator('tspan').first()
  const fontSize = Number(await zoomedText.getAttribute('font-size'))
  expect(Number(await zoomedTextLine.getAttribute('x'))).toBeCloseTo(expectedTextPosition.x, 0)
  expect(Number(await zoomedTextLine.getAttribute('y')) - fontSize).toBeCloseTo(expectedTextPosition.y, 0)

  await page.getByRole('button', { name: 'Select / Move' }).click()
  const zoomedTextBounds = await zoomedText.boundingBox()
  if (!zoomedTextBounds) throw new Error('The zoomed Text object is not visible for editing.')
  await page.mouse.dblclick(zoomedTextBounds.x + 5, zoomedTextBounds.y + zoomedTextBounds.height / 2)
  const editDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(editDraft).toHaveValue('Zoom text')
  await editDraft.fill('Edited at zoom')
  await page.keyboard.press('Control+Enter')
  await expect(zoomedText).toHaveAttribute('aria-label', 'Edited at zoom')

  await page.getByRole('button', { name: 'Fit' }).click()
  const fitBoard = await svg.boundingBox()
  const fitWorkspace = await workspace.boundingBox()
  if (!fitBoard || !fitWorkspace) throw new Error('The Artboard could not return to Fit.')
  expect(fitBoard.width).toBeLessThanOrEqual(fitWorkspace.width)
  expect(fitBoard.height).toBeLessThanOrEqual(fitWorkspace.height)
})

test('Paint palette colors new and selected objects, supports Undo/Redo, and exports matching PNG pixels', async ({ page }) => {
  const svg = await createArtboard(page, 320, 240)
  const paletteColor = (color: string) => page.locator(`[data-palette-color="${color}"]`)
  await expect(page.getByRole('region', { name: 'Color palette' })).toBeVisible()

  await paletteColor('#ff0000').click()
  await paletteColor('#00ff00').click({ button: 'right' })
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await dragOnArtboard(page, svg, { x: 0.2, y: 0.2 }, { x: 0.55, y: 0.55 })
  const rectangle = svg.locator(':scope > rect').nth(1)
  await expect(rectangle).toHaveAttribute('stroke', '#ff0000')
  await expect(rectangle).toHaveAttribute('fill', '#00ff00')

  await page.getByRole('button', { name: 'Select / Move' }).click()
  const rectangleBox = await rectangle.boundingBox()
  if (!rectangleBox) throw new Error('The colored Rectangle is not visible.')
  await page.mouse.click(rectangleBox.x + rectangleBox.width / 2, rectangleBox.y + rectangleBox.height / 2)
  await expect(page.getByText('Rectangle Properties', { exact: true })).toBeVisible()

  await paletteColor('#0000ff').click()
  await expect(rectangle).toHaveAttribute('stroke', '#0000ff')
  await paletteColor('#ffff00').click({ button: 'right' })
  await expect(rectangle).toHaveAttribute('fill', '#ffff00')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('fill', '#00ff00')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('fill', '#ffff00')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('fill', '#00ff00')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('stroke', '#ff0000')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('stroke', '#0000ff')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('fill', '#ffff00')

  const fillPicker = page.locator('[data-inspector-color-picker="fill"]')
  await page.evaluate(() => {
    const picker = document.querySelector<HTMLInputElement>('[data-inspector-color-picker="fill"]')
    if (!picker) throw new Error('The Inspector Fill color picker is missing.')
    picker.addEventListener('click', (event) => {
      event.preventDefault()
      picker.dataset.pickerInvoked = 'true'
    }, { once: true })
  })
  await fillPicker.click()
  await expect(fillPicker).toHaveAttribute('data-picker-invoked', 'true')
  await fillPicker.evaluate((element) => {
    const input = element as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, '#fedcba')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(rectangle).toHaveAttribute('fill', '#fedcba')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('fill', '#ffff00')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('fill', '#fedcba')

  const strokePicker = page.locator('[data-inspector-color-picker="stroke"]')
  await page.evaluate(() => {
    const picker = document.querySelector<HTMLInputElement>('[data-inspector-color-picker="stroke"]')
    if (!picker) throw new Error('The Inspector Stroke color picker is missing.')
    picker.addEventListener('click', (event) => event.preventDefault(), { once: true })
  })
  await page.getByRole('button', { name: 'Choose Stroke Color' }).press('Enter')
  await strokePicker.evaluate((element) => {
    const input = element as HTMLInputElement
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(input, '#123456')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect(page.getByRole('button', { name: 'Choose Stroke Color' })).toBeFocused()
  await expect(rectangle).toHaveAttribute('stroke', '#123456')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('stroke', '#0000ff')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('stroke', '#123456')

  await page.getByRole('button', { name: 'Choose custom color' }).click()
  const colorDialog = page.getByRole('dialog', { name: 'Custom Color' })
  await expect(colorDialog).toBeVisible()
  await colorDialog.getByRole('radio', { name: 'Rectangle fill' }).check()
  await colorDialog.getByRole('textbox', { name: 'Custom color HEX' }).fill('#123abc')
  await colorDialog.getByRole('button', { name: 'OK' }).click()
  await expect(rectangle).toHaveAttribute('fill', '#123abc')
  await page.keyboard.press('Control+z')
  await expect(rectangle).toHaveAttribute('fill', '#fedcba')
  await page.keyboard.press('Control+y')
  await expect(rectangle).toHaveAttribute('fill', '#123abc')

  const fillColor = page.getByRole('textbox', { name: 'Fill Color', exact: true })
  await fillColor.fill('#ff00ff')
  await fillColor.press('Enter')
  await expect(rectangle).toHaveAttribute('fill', '#ff00ff')
  const strokeColor = page.getByRole('textbox', { name: 'Stroke Color' })
  await strokeColor.fill('#00ffff')
  await strokeColor.press('Enter')
  await expect(rectangle).toHaveAttribute('stroke', '#00ffff')
  const strokeWidth = page.getByRole('textbox', { name: 'Stroke Width' })
  await strokeWidth.fill('4')
  await strokeWidth.press('Enter')
  await expect(rectangle).toHaveAttribute('stroke-width', '4')

  const board = await svg.boundingBox()
  if (!board) throw new Error('The Artboard is not visible for Text creation.')
  await page.getByRole('button', { name: 'Select / Move' }).click()
  await page.mouse.click(board.x + board.width * 0.92, board.y + board.height * 0.9)
  await page.getByRole('button', { name: 'Text' }).click()
  await paletteColor('#800080').click()
  await page.mouse.click(board.x + board.width * 0.68, board.y + board.height * 0.16)
  const textDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(textDraft).toBeFocused()
  await page.keyboard.type('Palette text')
  await page.keyboard.press('Control+Enter')
  await expect(svg.locator('text')).toHaveAttribute('fill', '#800080')

  const exportPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: /Export PNG/ }).click()
  const download = await exportPromise
  const pngPath = await download.path()
  if (!pngPath) throw new Error('The palette export did not produce a PNG file.')
  const pngBytes = await readFile(pngPath)
  expect(pngBytes.readUInt32BE(16)).toBe(320)
  expect(pngBytes.readUInt32BE(20)).toBe(240)
  const centerPixel = await page.evaluate(async ({ base64, x, y }) => {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not inspect palette export pixels.')
    context.drawImage(image, 0, 0)
    const pixel = [...context.getImageData(x, y, 1, 1).data]
    image.close()
    return pixel
  }, {
    base64: pngBytes.toString('base64'),
    x: 120,
    y: 90,
  })
  expect(centerPixel).toEqual([255, 0, 255, 255])
  const strokePixel = await page.evaluate(async ({ base64, x, y }) => {
    const binary = atob(base64)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not inspect exported stroke pixels.')
    context.drawImage(image, 0, 0)
    const pixel = [...context.getImageData(x, y, 1, 1).data]
    image.close()
    return pixel
  }, { base64: pngBytes.toString('base64'), x: 100, y: 49 })
  expect(strokePixel).toEqual([0, 255, 255, 255])
})

test('pointer cancellation clears Space+Drag and later tool use still works', async ({ page }) => {
  const svg = await createArtboard(page, 500, 400)
  const before = await svg.boundingBox()
  if (!before) throw new Error('The Artboard is not visible.')
  const pointer = { x: before.x + before.width / 2, y: before.y + before.height / 2 }
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await page.keyboard.down('Space')
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 60, pointer.y + 30, { steps: 2 })
  const afterPanMove = await svg.boundingBox()
  expect(afterPanMove?.x).toBeCloseTo(before.x + 60, 0)
  expect(afterPanMove?.y).toBeCloseTo(before.y + 30, 0)
  await page.locator('.editor-canvas-wrap').dispatchEvent('pointercancel', {
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
  })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await expect(svg.locator(':scope > rect')).toHaveCount(1)

  const afterCancel = await svg.boundingBox()
  if (!afterCancel) throw new Error('The Artboard is not visible after pointer cancellation.')
  const from = { x: afterCancel.x + afterCancel.width * 0.25, y: afterCancel.y + afterCancel.height * 0.25 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 50, from.y + 40, { steps: 3 })
  await page.mouse.up()
  await expect(svg.locator(':scope > rect')).toHaveCount(2)
})

test('Space+Arrow keys pan the camera without changing the document', async ({ page }) => {
  const svg = await createArtboard(page, 500, 400)
  const before = await svg.boundingBox()
  if (!before) throw new Error('The Artboard is not visible.')

  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await svg.boundingBox())?.x).toBeCloseTo(before.x, 0)
  await page.keyboard.down('Space')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.up('Space')

  const after = await svg.boundingBox()
  if (!after) throw new Error('The Artboard is not visible after keyboard panning.')
  expect(after.x).toBeCloseTo(before.x + 32, 0)
  expect(after.y).toBeCloseTo(before.y + 32, 0)
  await expect(svg.locator(':scope > rect')).toHaveCount(1)
})

test('multiline Text, Inspector Enter/Escape and Undo work through the UI', async ({ page }) => {
  const svg = await createArtboard(page, 320, 240)
  const board = await svg.boundingBox()
  if (!board) throw new Error('The Artboard SVG is not visible.')
  await page.getByRole('button', { name: 'Text' }).click()
  await page.mouse.click(board.x + 32, board.y + 32)

  const draft = page.getByRole('textbox', { name: /Type text/ })
  await expect(draft).toBeFocused()
  await page.keyboard.type('discard this draft')
  await page.keyboard.press('Escape')
  await expect(draft).toHaveCount(0)
  await expect(svg.locator('text')).toHaveCount(0)

  await page.mouse.click(board.x + board.width * 0.2, board.y + board.height * 0.2)
  const textDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(textDraft).toBeFocused()
  await page.keyboard.type('First line')
  await page.keyboard.press('Space')
  await page.keyboard.type('with space')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second line')
  await expect(textDraft).toHaveValue('First line with space\nSecond line')
  await page.keyboard.press('Control+Enter')

  const text = svg.locator('text')
  await expect(text).toHaveCount(1)
  await expect(text).toHaveAttribute('aria-label', 'First line with space\nSecond line')

  await page.getByRole('button', { name: 'Select / Move' }).click()
  await page.mouse.click(board.x + board.width * 0.9, board.y + board.height * 0.9)
  const firstLine = text.locator('tspan').first()
  const lineBox = await firstLine.boundingBox()
  if (!lineBox) throw new Error('The rendered Text is not visible.')
  await page.mouse.click(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height / 2)
  await expect(page.getByText('Text Properties', { exact: true })).toBeVisible()

  const fontSize = page.getByRole('textbox', { name: 'Font Size' })
  await fontSize.fill('32')
  await fontSize.press('Enter')
  await expect(text).toHaveAttribute('font-size', '32')

  await page.keyboard.press('Control+z')
  await expect(text).toHaveAttribute('font-size', '20')

  await fontSize.fill('40')
  await fontSize.press('Escape')
  await expect(fontSize).toHaveValue('20')
  await expect(text).toHaveAttribute('font-size', '20')
})

test('Export PNG downloads raster bytes with the Artboard size and expected pixels', async ({ page }) => {
  const svg = await createArtboard(page, 160, 120)
  await page.getByRole('button', { name: 'Rectangle' }).click()
  await dragOnArtboard(page, svg, { x: 0.125, y: 0.167 }, { x: 0.5, y: 0.667 })

  const rectangle = svg.locator(':scope > rect').nth(1)
  await expect(rectangle).toBeVisible()
  const rectangleBox = await rectangle.boundingBox()
  if (!rectangleBox) throw new Error('The drawn Rectangle is not visible.')
  await page.getByRole('button', { name: 'Select / Move' }).click()
  await page.mouse.click(rectangleBox.x + rectangleBox.width / 2, rectangleBox.y + rectangleBox.height / 2)
  const fillColor = page.getByRole('textbox', { name: 'Fill Color', exact: true })
  await fillColor.fill('#ff0000')
  await fillColor.press('Enter')
  await expect(rectangle).toHaveAttribute('fill', '#ff0000')

  const board = await svg.boundingBox()
  if (!board) throw new Error('The Artboard SVG is not visible.')
  await page.getByRole('button', { name: 'Text' }).click()
  await page.mouse.click(board.x + board.width * 0.65, board.y + board.height * 0.2)
  const textDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(textDraft).toBeFocused()
  await page.keyboard.type('PNG')
  await page.keyboard.press('Control+Enter')
  await expect(svg.locator('text')).toHaveAttribute('aria-label', 'PNG')

  await page.getByRole('button', { name: 'File' }).click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: /Export PNG/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('Untitled.png')
  await expect(page.getByRole('status')).toContainText('PNG exported.')

  const path = await download.path()
  if (!path) throw new Error('The browser did not retain the downloaded PNG file.')
  const bytes = await readFile(path)
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.readUInt32BE(16)).toBe(160)
  expect(bytes.readUInt32BE(20)).toBe(120)

  const pixels = await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const png = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }))
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not inspect the downloaded PNG pixels.')
    context.drawImage(bitmap, 0, 0)
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data)
    const result = {
      width: bitmap.width,
      height: bitmap.height,
      background: sample(5, 5),
      figure: sample(50, 50),
      backgroundCorner: sample(155, 115),
    }
    bitmap.close()
    return result
  }, bytes.toString('base64'))

  expect(pixels).toEqual({
    width: 160,
    height: 120,
    background: [255, 255, 255, 255],
    figure: [255, 0, 0, 255],
    backgroundCorner: [255, 255, 255, 255],
  })
})
