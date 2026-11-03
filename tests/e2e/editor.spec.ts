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
  await page.keyboard.press('Enter')
  await page.keyboard.type('Second line')
  await expect(textDraft).toHaveValue('First line\nSecond line')
  await page.keyboard.press('Control+Enter')

  const text = svg.locator('text')
  await expect(text).toHaveCount(1)
  await expect(text).toHaveAttribute('aria-label', 'First line\nSecond line')

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
  const fillColor = page.getByRole('textbox', { name: 'Fill Color' })
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
