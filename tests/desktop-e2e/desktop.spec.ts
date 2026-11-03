import { _electron as electron, expect, test as base, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { copyFile, cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import type { ChildProcess } from 'node:child_process'

type DesktopOptions = { installCodeCard: boolean; installWin95Window?: boolean; installHelloWorld?: boolean }
type DesktopHarness = {
  app: ElectronApplication
  page: Page
  userDataDir: string
  dialogDir: string
  pngExportPath: string
  close: () => Promise<void>
  processExitReason: () => string | null
  rendererErrors: () => string[]
}
type DesktopFixtures = { desktop: DesktopHarness; desktopOptions: DesktopOptions }

async function raceWithTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(undefined), milliseconds)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const test = base.extend<DesktopFixtures>({
  desktopOptions: [{ installCodeCard: false }, { option: true }],
  desktop: async ({ desktopOptions }, use, testInfo) => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'paintsmys-desktop-e2e-'))
    const userDataDir = join(tempRoot, 'user-data')
    const dialogDir = join(tempRoot, 'dialogs')
    const pngExportPath = join(dialogDir, 'hello-world-export.png')
    await mkdir(userDataDir, { recursive: true })
    await mkdir(dialogDir, { recursive: true })

    if (desktopOptions.installCodeCard) {
      const installedPluginDir = join(userDataDir, 'plugins', 'code-card')
      await mkdir(installedPluginDir, { recursive: true })
      await copyFile(resolve('examples/plugins/code-card/manifest.json'), join(installedPluginDir, 'manifest.json'))
      await copyFile(resolve('examples/plugins/code-card/index.js'), join(installedPluginDir, 'index.js'))
    }
    if (desktopOptions.installWin95Window) {
      const installedPluginDir = join(userDataDir, 'plugins', 'win95-window')
      await mkdir(installedPluginDir, { recursive: true })
      await copyFile(resolve('examples/plugins/win95-window/manifest.json'), join(installedPluginDir, 'manifest.json'))
      await copyFile(resolve('examples/plugins/win95-window/index.js'), join(installedPluginDir, 'index.js'))
    }
    if (desktopOptions.installHelloWorld) {
      await cp(resolve('examples/plugins/hello-world'), join(userDataDir, 'plugins', 'hello-world'), { recursive: true })
    }

    const diagnosticLines: string[] = []
    const rendererErrors: string[] = []
    let diagnosticBytes = 0
    const appendDiagnostic = (message: string) => {
      const line = `${message}\n`
      diagnosticLines.push(line)
      diagnosticBytes += Buffer.byteLength(line)
      while (diagnosticBytes > 64 * 1024 && diagnosticLines.length > 1) {
        diagnosticBytes -= Buffer.byteLength(diagnosticLines.shift() ?? '')
      }
    }

    let app: ElectronApplication | null = null
    let page: Page | null = null
    let child: ChildProcess | null = null
    let processExit: string | null = null
    let processExitPromise: Promise<void> | null = null
    let tracingStarted = false
    let traceIssue: string | null = null
    let setupOrTestFailure: string | null = null
    let closePromise: Promise<void> | null = null

    const waitForProcessExit = async (milliseconds: number) => {
      if (processExit || !processExitPromise) return
      await raceWithTimeout(processExitPromise, milliseconds)
    }

    const close = async () => {
      if (closePromise) return closePromise
      closePromise = (async () => {
        if (app && !processExit) {
          const closeAttempt = app.close()
          await raceWithTimeout(
            closeAttempt.catch((error: unknown) => appendDiagnostic(`Electron close error: ${String(error)}`)),
            8_000,
          )
        }
        await waitForProcessExit(3_000)
        if (!processExit && child) {
          appendDiagnostic('Electron did not exit after Playwright close; sending SIGTERM to the launched process.')
          child.kill('SIGTERM')
          await waitForProcessExit(2_000)
        }
        if (!processExit && child) {
          appendDiagnostic('Electron did not exit after SIGTERM; sending SIGKILL to the launched process.')
          child.kill('SIGKILL')
          await waitForProcessExit(2_000)
        }
        if (!processExit && child) throw new Error('The Electron process could not be stopped.')
      })()
      return closePromise
    }

    try {
      const launchEnv = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] =>
          entry[1] !== undefined && entry[0] !== 'ELECTRON_RENDERER_URL'),
      )
      app = await electron.launch({
        args: [
          resolve('dist/main/main.js'),
          '--paint-smys-e2e',
          `--paint-smys-user-data=${userDataDir}`,
          `--paint-smys-e2e-dialog-dir=${dialogDir}`,
        ],
        cwd: process.cwd(),
        env: launchEnv,
        chromiumSandbox: true,
      })
      child = app.process()
      processExitPromise = new Promise<void>((resolveExit) => {
        child?.once('close', (code, signal) => {
          processExit = `exit code ${String(code)}, signal ${signal ?? 'none'}`
          resolveExit()
        })
      })
      child.stdout?.on('data', (chunk: Buffer | string) => appendDiagnostic(`Electron stdout: ${String(chunk)}`))
      child.stderr?.on('data', (chunk: Buffer | string) => appendDiagnostic(`Electron stderr: ${String(chunk)}`))
      app.on('console', (message) => {
        if (message.type() === 'error') appendDiagnostic(`Electron main console.error: ${message.text()}`)
      })
      app.on('close', () => appendDiagnostic('Playwright observed ElectronApplication close.'))

      page = await app.firstWindow()
      page.on('console', (message) => {
        if (message.type() === 'error') {
          rendererErrors.push(message.text())
          appendDiagnostic(`Renderer console.error: ${message.text()}`)
        }
      })
      page.on('pageerror', (error) => {
        rendererErrors.push(error.stack ?? error.message)
        appendDiagnostic(`Renderer pageerror: ${error.stack ?? error.message}`)
      })
      try {
        await app.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
        tracingStarted = true
      } catch (error) {
        traceIssue = `Playwright Electron trace unavailable: ${error instanceof Error ? error.message : String(error)}`
      }

      const harness: DesktopHarness = {
        app,
        page,
        userDataDir,
        dialogDir,
        pngExportPath,
        close,
        processExitReason: () => processExit,
        rendererErrors: () => [...rendererErrors],
      }
      await use(harness)
    } catch (error) {
      setupOrTestFailure = error instanceof Error ? error.stack ?? error.message : String(error)
      throw error
    } finally {
      const failed = Boolean(setupOrTestFailure) || testInfo.status !== testInfo.expectedStatus
      if (failed && page) {
        const screenshotPath = testInfo.outputPath('electron-renderer.png')
        try {
          await page.screenshot({ path: screenshotPath, fullPage: true, timeout: 5_000 })
          await testInfo.attach('electron-renderer-screenshot', { path: screenshotPath, contentType: 'image/png' })
        } catch (error) {
          appendDiagnostic(`Renderer screenshot failed: ${String(error)}`)
        }
      }
      if (tracingStarted && app) {
        try {
          if (failed) {
            const tracePath = testInfo.outputPath('electron-trace.zip')
            await app.context().tracing.stop({ path: tracePath })
            await testInfo.attach('electron-playwright-trace', { path: tracePath, contentType: 'application/zip' })
          } else {
            await app.context().tracing.stop()
          }
        } catch (error) {
          appendDiagnostic(`Playwright trace finalization failed: ${String(error)}`)
        }
      }
      try {
        await close()
      } catch (error) {
        appendDiagnostic(`Electron process cleanup failed: ${String(error)}`)
      }
      if (failed) {
        const lines = [
          `Scenario: ${testInfo.titlePath.join(' › ')}`,
          `Process termination: ${processExit ?? 'not observed'}`,
          traceIssue ?? '',
          setupOrTestFailure ? `Failure: ${setupOrTestFailure}` : '',
          ...diagnosticLines,
        ].filter(Boolean)
        await testInfo.attach('electron-diagnostics', {
          body: Buffer.from(lines.join('\n')),
          contentType: 'text/plain',
        })
      }
      await rm(tempRoot, { recursive: true, force: true })
    }
  },
})

async function createArtboard(page: Page, width: number, height: number) {
  await expect(page.getByRole('heading', { name: 'Welcome to paintSMYS' })).toBeVisible()
  await page.getByRole('button', { name: /New Project/ }).click()
  await page.getByLabel('Width (px)').fill(String(width))
  await page.getByLabel('Height (px)').fill(String(height))
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  const svg = page.getByRole('img', { name: 'Scene contents' })
  await expect(svg).toBeVisible()
  return svg
}

async function drawRectangle(page: Page, svg: Locator) {
  await page.getByRole('button', { name: 'Rectangle' }).click()
  const bounds = await svg.boundingBox()
  if (!bounds) throw new Error('The Desktop Artboard SVG has no visible bounds.')
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.55, bounds.y + bounds.height * 0.6, { steps: 4 })
  await page.mouse.up()
  await expect(svg.locator(':scope > rect')).toHaveCount(2)
}

async function openCodeCardCommand(page: Page) {
  await page.getByRole('button', { name: 'Plugins' }).click()
  const command = page.getByRole('menuitem', { name: 'Generate Code Card', exact: true })
  await expect(command).toBeVisible()
  await command.click()
  const dialog = page.getByRole('dialog', { name: 'Generate Code Card' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openWin95WindowCommand(page: Page) {
  await page.getByRole('button', { name: 'Plugins' }).click()
  const command = page.getByRole('menuitem', { name: 'Generate Win95 Window', exact: true })
  await expect(command).toBeVisible()
  await command.click()
  const dialog = page.getByRole('dialog', { name: 'Generate Win95 Window' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function fillCodeCard(page: Page, sourceCode: string) {
  await page.getByLabel('Window title').fill('paintSMYS E2E')
  await page.getByLabel('Language').selectOption('python')
  await page.getByLabel('Source code').fill(sourceCode)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
}

function decodePngRgba(pngBytes: Buffer): { width: number; height: number; pixelAt: (x: number, y: number) => number[] } {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  expect(pngBytes.subarray(0, 8)).toEqual(signature)
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  const compressedData: Buffer[] = []
  let offset = 8
  while (offset + 12 <= pngBytes.length) {
    const length = pngBytes.readUInt32BE(offset)
    const type = pngBytes.toString('ascii', offset + 4, offset + 8)
    const chunk = pngBytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      bitDepth = chunk[8] ?? 0
      colorType = chunk[9] ?? 0
    } else if (type === 'IDAT') compressedData.push(chunk)
    offset += length + 12
    if (type === 'IEND') break
  }

  expect(bitDepth).toBe(8)
  expect(colorType).toBe(6)
  const bytesPerPixel = 4
  const rowLength = width * bytesPerPixel
  const filtered = inflateSync(Buffer.concat(compressedData))
  const rows: Buffer[] = []
  let inputOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[inputOffset] ?? 0
    inputOffset += 1
    const row = Buffer.from(filtered.subarray(inputOffset, inputOffset + rowLength))
    inputOffset += rowLength
    const previous = rows[y - 1]
    for (let x = 0; x < rowLength; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0
      const above = previous?.[x] ?? 0
      const upperLeft = x >= bytesPerPixel ? previous?.[x - bytesPerPixel] ?? 0 : 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = above
      else if (filter === 3) predictor = Math.floor((left + above) / 2)
      else if (filter === 4) {
        const estimate = left + above - upperLeft
        const leftDistance = Math.abs(estimate - left)
        const aboveDistance = Math.abs(estimate - above)
        const upperLeftDistance = Math.abs(estimate - upperLeft)
        predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft
      } else expect(filter).toBe(0)
      row[x] = ((row[x] ?? 0) + predictor) & 0xff
    }
    rows.push(row)
  }

  return {
    width,
    height,
    pixelAt(x, y) {
      if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
        throw new Error('The requested PNG pixel is outside the image.')
      }
      const row = rows[y]
      if (!row) throw new Error('The exported PNG pixel row is missing.')
      const pixelOffset = x * bytesPerPixel
      return [...row.subarray(pixelOffset, pixelOffset + bytesPerPixel)]
    },
  }
}

test.describe('real installed Hello World plugin', () => {
  test.use({ desktopOptions: { installCodeCard: false, installHelloWorld: true } })

  test('loads the command, creates selectable objects in one undo step, redoes them, and exports PNG', async ({ desktop }) => {
    const page = desktop.page
    const svg = await createArtboard(page, 1280, 720)
    const pluginRuntime = page.locator('iframe[title="Hello World plugin runtime"]')
    await expect(pluginRuntime).toHaveAttribute('sandbox', 'allow-scripts')
    await page.getByRole('button', { name: 'Plugins' }).click()
    const command = page.getByRole('menuitem', { name: 'Hello World', exact: true })
    await expect(command).toBeVisible()
    await command.click()

    const rectangle = svg.locator(':scope > rect').nth(1)
    const text = svg.locator('text[aria-label="Hello from paintSMYS!"]')
    await expect(rectangle).toHaveAttribute('fill', '#2f6fed')
    await expect(text).toBeVisible()
    await expect(page.getByText('2 objects', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Select / Move' }).click()
    const rectangleBounds = await rectangle.boundingBox()
    if (!rectangleBounds) throw new Error('The Hello World Rectangle is not visible on the Artboard.')
    await page.mouse.click(rectangleBounds.x + rectangleBounds.width / 4, rectangleBounds.y + rectangleBounds.height / 4)
    await expect(page.getByText('Rectangle Properties', { exact: true })).toBeVisible()

    const textBounds = await text.boundingBox()
    if (!textBounds) throw new Error('The Hello World Text is not visible on the Artboard.')
    await page.mouse.click(textBounds.x + textBounds.width / 2, textBounds.y + textBounds.height / 2)
    await expect(page.getByText('Text Properties', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /Undo/ }).click()
    await expect(svg.locator(':scope > rect')).toHaveCount(1)
    await expect(svg.locator(':scope > text')).toHaveCount(0)
    await expect(page.getByText('0 objects', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: /Redo/ }).click()
    await expect(svg.locator(':scope > rect')).toHaveCount(2)
    await expect(text).toBeVisible()

    await page.getByRole('button', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Export PNG…' }).click()
    await expect(page.getByRole('status')).toContainText('PNG exported.')
    const pngBytes = await readFile(desktop.pngExportPath)
    const rectangleX = Number(await rectangle.getAttribute('x'))
    const rectangleY = Number(await rectangle.getAttribute('y'))
    const png = decodePngRgba(pngBytes)
    expect({ width: png.width, height: png.height }).toEqual({ width: 1280, height: 720 })
    expect(png.pixelAt(rectangleX + 10, rectangleY + 10)).toEqual([47, 111, 237, 255])
    const textX = Number(await text.locator('tspan').first().getAttribute('x'))
    const textY = Number(await text.locator('tspan').first().getAttribute('y'))
    const textPixelFound = Array.from({ length: 38 }, (_, row) => row)
      .some((row) => Array.from({ length: 360 }, (_, column) => column)
        .some((column) => {
          const sample = png.pixelAt(textX + column, textY - 30 + row)
          return sample[0] === 255 && sample[1] === 255 && sample[2] === 255
        }))
    expect(textPixelFound).toBe(true)
    expect(desktop.rendererErrors()).toEqual([])
  })
})

test('starts the real Electron app, creates a project, draws a Rectangle, and exits', async ({ desktop }) => {
  const pageUrl = new URL(desktop.page.url())
  expect(pageUrl.protocol).toBe('file:')
  expect(pageUrl.pathname).toContain('/dist/renderer/desktop.html')
  expect(await desktop.page.evaluate(() => typeof window.paintSMYS?.saveProject)).toBe('function')

  const svg = await createArtboard(desktop.page, 640, 480)
  await drawRectangle(desktop.page, svg)
  await expect(desktop.page.getByText('1 objects', { exact: true })).toBeVisible()
  await desktop.close()
  expect(desktop.processExitReason()).not.toBeNull()
})

test('saves and screenshots an open project with the classic color palette', async ({ desktop }, testInfo) => {
  const page = desktop.page
  const svg = await createArtboard(page, 800, 520)
  const paletteColor = (color: string) => page.locator(`[data-palette-color="${color}"]`)
  await page.getByRole('button', { name: 'Rectangle' }).click()

  async function drawColoredRectangle(
    from: { x: number; y: number },
    to: { x: number; y: number },
    stroke: string,
    fill: string,
  ) {
    await paletteColor(stroke).click()
    await paletteColor(fill).click({ button: 'right' })
    const bounds = await svg.boundingBox()
    if (!bounds) throw new Error('The Artboard is not visible for the palette screenshot.')
    await page.mouse.move(bounds.x + bounds.width * from.x, bounds.y + bounds.height * from.y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * to.x, bounds.y + bounds.height * to.y, { steps: 5 })
    await page.mouse.up()
  }

  await drawColoredRectangle({ x: 0.08, y: 0.15 }, { x: 0.4, y: 0.72 }, '#0000ff', '#00ffff')
  await drawColoredRectangle({ x: 0.54, y: 0.14 }, { x: 0.91, y: 0.43 }, '#800000', '#ffff00')
  await drawColoredRectangle({ x: 0.54, y: 0.56 }, { x: 0.91, y: 0.86 }, '#008000', '#80ff00')

  const rectangles = svg.locator(':scope > rect')
  await expect(rectangles).toHaveCount(4)
  await expect(rectangles.nth(1)).toHaveAttribute('stroke', '#0000ff')
  await expect(rectangles.nth(1)).toHaveAttribute('fill', '#00ffff')
  await expect(rectangles.nth(2)).toHaveAttribute('stroke', '#800000')
  await expect(rectangles.nth(2)).toHaveAttribute('fill', '#ffff00')
  await expect(rectangles.nth(3)).toHaveAttribute('stroke', '#008000')
  await expect(rectangles.nth(3)).toHaveAttribute('fill', '#80ff00')

  await page.getByRole('button', { name: 'Text' }).click()
  await paletteColor('#800080').click()
  const boardBounds = await svg.boundingBox()
  if (!boardBounds) throw new Error('The Artboard is not visible for the palette screenshot text.')
  await page.mouse.click(boardBounds.x + boardBounds.width * 0.08, boardBounds.y + boardBounds.height * 0.9)
  const textDraft = page.getByRole('textbox', { name: /Type text/ })
  await expect(textDraft).toBeFocused()
  await page.keyboard.type('PAINTSMYS COLOR TEST')
  await page.keyboard.press('Control+Enter')
  const text = svg.locator('text')
  await expect(text).toHaveAttribute('fill', '#800080')

  await page.getByRole('button', { name: 'Select / Move' }).click()
  const firstRectangleBounds = await rectangles.nth(1).boundingBox()
  if (!firstRectangleBounds) throw new Error('The first palette Rectangle has no visible bounds.')
  await page.mouse.click(firstRectangleBounds.x + firstRectangleBounds.width / 2, firstRectangleBounds.y + firstRectangleBounds.height / 2)
  await expect(page.getByText('Rectangle Properties', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'File' }).click()
  await page.getByRole('menuitem', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Project saved.')

  const projectPath = join(desktop.dialogDir, 'Saved Project')
  const manifest = JSON.parse(await readFile(join(projectPath, 'project.json'), 'utf8')) as {
    scene: { artboard: { width: number; height: number }; objects: Array<{ type: string; fill?: string; stroke?: string; color?: string }> }
  }
  expect(manifest.scene.artboard).toEqual({ width: 800, height: 520, backgroundColor: '#ffffff' })
  expect(manifest.scene.objects).toHaveLength(4)
  const screenshotPath = testInfo.outputPath('paintsmys-color-palette.png')
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await testInfo.attach('paintsmys-color-palette', { path: screenshotPath, contentType: 'image/png' })
})

test('saves project.json through Desktop IPC and opens it with a clean, valid document', async ({ desktop }) => {
  const svg = await createArtboard(desktop.page, 640, 480)
  await drawRectangle(desktop.page, svg)

  await desktop.page.getByRole('button', { name: 'File' }).click()
  await desktop.page.getByRole('menuitem', { name: 'Save', exact: true }).click()
  await expect(desktop.page.getByRole('status')).toContainText('Project saved.')

  const projectPath = join(desktop.dialogDir, 'Saved Project')
  const manifestText = await readFile(join(projectPath, 'project.json'), 'utf8')
  const manifest = JSON.parse(manifestText) as { scene: { objects: Array<{ type: string; width?: number; height?: number }> } }
  expect(manifest.scene.objects).toHaveLength(1)
  expect(manifest.scene.objects[0]?.type).toBe('rectangle')
  expect(manifest.scene.objects[0]?.width).toBeGreaterThan(0)
  expect(manifest.scene.objects[0]?.height).toBeGreaterThan(0)

  await desktop.page.getByRole('button', { name: 'File' }).click()
  await desktop.page.getByRole('menuitem', { name: 'Open Project…' }).click()
  await expect(svg.locator(':scope > rect')).toHaveCount(2)
  await expect(desktop.page.getByText('Saved project', { exact: true })).toBeVisible()
  await expect(desktop.page.getByText('Project opened from folder', { exact: true })).toBeVisible()

  const savedRectangle = svg.locator(':scope > rect').nth(1)
  const box = await savedRectangle.boundingBox()
  if (!box) throw new Error('The saved Rectangle is not visible after reopening.')
  await desktop.page.getByRole('button', { name: 'Select / Move' }).click()
  await desktop.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const fillColor = desktop.page.getByRole('textbox', { name: 'Fill Color' })
  await fillColor.fill('#123456')
  await fillColor.press('Enter')
  await expect(savedRectangle).toHaveAttribute('fill', '#123456')
  await expect(desktop.page.getByText('Unsaved session', { exact: true })).toBeVisible()
})

test.describe('real installed Code Card plugin', () => {
  test.use({ desktopOptions: { installCodeCard: true } })

  test('runs Shiki through the sandboxed iframe and commits one undoable Code Card', async ({ desktop }) => {
    const svg = await createArtboard(desktop.page, 1000, 640)
    const iframe = desktop.page.locator('iframe[title="Win95 Code Card plugin runtime"]')
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts')
    await openCodeCardCommand(desktop.page)
    await fillCodeCard(desktop.page, 'def paint():\n    return "paintSMYS"')

    await expect(desktop.page.getByRole('dialog', { name: 'Generate Code Card' })).toBeHidden()
    await expect.poll(async () => (await svg.locator('text').allTextContents()).join('\n')).toContain('return "paintSMYS"')
    const highlightedColors = await svg.locator('text tspan[fill]').evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => node.getAttribute('fill')).filter((color): color is string => color !== null))],
    )
    expect(highlightedColors.length).toBeGreaterThanOrEqual(2)
    const generatedObjectCount = await svg.locator(':scope > rect').count() + await svg.locator(':scope > text').count() - 1
    expect(generatedObjectCount).toBeGreaterThan(1)
    await expect(desktop.page.getByText(`${generatedObjectCount} objects`, { exact: true })).toBeVisible()

    await desktop.page.getByRole('button', { name: 'Edit' }).click()
    await desktop.page.getByRole('menuitem', { name: /Undo/ }).click()
    await expect(svg.locator(':scope > rect')).toHaveCount(1)
    await expect(svg.locator(':scope > text')).toHaveCount(0)
    await expect(desktop.page.getByText('0 objects', { exact: true })).toBeVisible()

    await desktop.page.getByRole('button', { name: 'Edit' }).click()
    await desktop.page.getByRole('menuitem', { name: /Redo/ }).click()
    await expect.poll(async () => (await svg.locator('text').allTextContents()).join('\n')).toContain('return "paintSMYS"')
    expect(await svg.locator(':scope > rect').count() + await svg.locator(':scope > text').count() - 1).toBe(generatedObjectCount)
  })

  test('cancels with Escape, keeps the editor responsive, and can invoke the plugin again', async ({ desktop }) => {
    const svg = await createArtboard(desktop.page, 1000, 640)
    const dialog = await openCodeCardCommand(desktop.page)
    await desktop.page.getByLabel('Window title').fill('Cancelled card')
    await desktop.page.getByLabel('Language').selectOption('python')
    await desktop.page.getByLabel('Source code').fill('def cancelled():\n    return "never added"')
    await desktop.page.keyboard.press('Escape')

    await expect(dialog).toBeHidden()
    await expect(svg.locator(':scope > rect')).toHaveCount(1)
    await expect(svg.locator(':scope > text')).toHaveCount(0)
    await expect(desktop.page.getByText('0 objects', { exact: true })).toBeVisible()

    await drawRectangle(desktop.page, svg)
    await expect(desktop.page.getByText('1 objects', { exact: true })).toBeVisible()
    await openCodeCardCommand(desktop.page)
    await fillCodeCard(desktop.page, 'def recovered():\n    return "invocation works"')
    await expect.poll(async () => (await svg.locator('text').allTextContents()).join('\n')).toContain('return "invocation works"')
    await expect.poll(async () => await svg.locator(':scope > rect').count()).toBeGreaterThan(2)
    await expect(svg.locator(':scope > text')).not.toHaveCount(0)
  })

  test('modal forms ignore camera gestures, then return control to the editor', async ({ desktop }) => {
    const svg = await createArtboard(desktop.page, 1000, 640)
    const zoomLevel = desktop.page.getByLabel('Zoom level')
    await expect(zoomLevel).toHaveText(/\d+%/)
    const originalZoom = await zoomLevel.textContent()
    const originalBounds = await svg.boundingBox()
    const dialog = await openCodeCardCommand(desktop.page)
    const dialogBounds = await dialog.boundingBox()
    if (!dialogBounds || !originalBounds) throw new Error('The modal or Artboard has no visible bounds.')

    await desktop.page.keyboard.down('Control')
    await desktop.page.mouse.move(dialogBounds.x + dialogBounds.width / 2, dialogBounds.y + dialogBounds.height / 2)
    await desktop.page.mouse.wheel(0, -600)
    await desktop.page.keyboard.up('Control')
    await expect(zoomLevel).toHaveText(originalZoom ?? '')

    const title = desktop.page.getByLabel('Window title')
    await title.fill('modal text')
    await title.press('Space')
    await expect(title).toHaveValue('modal text ')
    await desktop.page.keyboard.down('Space')
    await desktop.page.mouse.move(dialogBounds.x + dialogBounds.width / 2, dialogBounds.y + dialogBounds.height / 2)
    await desktop.page.mouse.down()
    await desktop.page.mouse.move(dialogBounds.x + dialogBounds.width / 2 + 45, dialogBounds.y + dialogBounds.height / 2 + 30, { steps: 3 })
    await desktop.page.mouse.up()
    await desktop.page.keyboard.up('Space')
    await expect(zoomLevel).toHaveText(originalZoom ?? '')
    const afterModalGestures = await svg.boundingBox()
    expect(afterModalGestures?.x).toBeCloseTo(originalBounds.x, 0)
    expect(afterModalGestures?.y).toBeCloseTo(originalBounds.y, 0)

    await desktop.page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await drawRectangle(desktop.page, svg)
    await expect(desktop.page.getByText('1 objects', { exact: true })).toBeVisible()
  })

  test('Code Card text stays readable and movable at 400% after panning', async ({ desktop }, testInfo) => {
    const svg = await createArtboard(desktop.page, 1280, 720)
    await openCodeCardCommand(desktop.page)
    await fillCodeCard(desktop.page, 'def paint():\n    return "paintSMYS"')
    const codeText = svg.locator('text[aria-label*="return "]')
    await expect(codeText).toBeVisible()

    await desktop.page.getByRole('button', { name: '100%' }).click()
    const zoomIn = desktop.page.getByRole('button', { name: 'Zoom in' })
    for (let step = 0; step < 12; step += 1) await zoomIn.click()
    await expect(desktop.page.getByLabel('Zoom level')).toHaveText('400%')

    const workspace = desktop.page.locator('.editor-canvas-wrap')
    const workspaceBounds = await workspace.boundingBox()
    if (!workspaceBounds) throw new Error('The Code Card workspace is not visible.')
    const panStart = { x: workspaceBounds.x + workspaceBounds.width / 2, y: workspaceBounds.y + workspaceBounds.height / 2 }
    for (let step = 0; step < 1; step += 1) {
      await desktop.page.keyboard.down('Space')
      await desktop.page.mouse.move(panStart.x, panStart.y)
      await desktop.page.mouse.down()
      await desktop.page.mouse.move(panStart.x + 80, panStart.y + 20, { steps: 3 })
      await desktop.page.mouse.up()
      await desktop.page.keyboard.up('Space')
    }

    const textBounds = await codeText.boundingBox()
    if (!textBounds) throw new Error('The Code Card source text is not visible after zooming and panning.')
    const screenshotPath = testInfo.outputPath('code-card-viewport-400.png')
    await desktop.page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach('code-card-viewport-400', { path: screenshotPath, contentType: 'image/png' })

    const firstLine = codeText.locator('tspan').first()
    const originalX = Number(await firstLine.getAttribute('x'))
    const originalY = Number(await firstLine.getAttribute('y'))
    await desktop.page.getByRole('button', { name: 'Select / Move' }).click()
    await desktop.page.mouse.move(textBounds.x + textBounds.width / 2, textBounds.y + textBounds.height / 2)
    await desktop.page.mouse.down()
    await desktop.page.mouse.move(textBounds.x + textBounds.width / 2 + 100, textBounds.y + textBounds.height / 2 + 40, { steps: 4 })
    await desktop.page.mouse.up()
    await expect.poll(async () => Number(await firstLine.getAttribute('x'))).toBeCloseTo(originalX + 25, 0)
    await expect.poll(async () => Number(await firstLine.getAttribute('y'))).toBeCloseTo(originalY + 10, 0)

    await desktop.page.getByRole('button', { name: 'Fit' }).click()
    const boardBounds = await svg.boundingBox()
    const fitBounds = await workspace.boundingBox()
    if (!boardBounds || !fitBounds) throw new Error('The Code Card did not return to Fit.')
    expect(boardBounds.width).toBeLessThanOrEqual(fitBounds.width)
    expect(boardBounds.height).toBeLessThanOrEqual(fitBounds.height)
  })
})

test.describe('real installed Win95 Window plugin', () => {
  test.use({ desktopOptions: { installCodeCard: false, installWin95Window: true } })

  test('renders one window with an internal status bar and no external menu', async ({ desktop }, testInfo) => {
    const svg = await createArtboard(desktop.page, 1000, 640)
    await openWin95WindowCommand(desktop.page)
    await desktop.page.getByLabel('Window title').fill('Visual E2E Program Manager - Desktop Layout')
    await desktop.page.getByLabel('Welcome message').fill('Welcome to the live SVG window layout check')
    await desktop.page.getByRole('button', { name: 'Generate', exact: true }).click()

    await expect(svg.locator('text[aria-label="Visual E2E Program Manager - Desktop Layout"]')).toBeVisible()
    await expect(svg.locator('text[aria-label="Welcome to the live SVG window layout check"]')).toBeVisible()
    await expect(svg.locator('text[aria-label="3 items"]')).toBeVisible()
    await expect(svg.locator('text[aria-label="Start"]')).toHaveCount(0)
    await expect(svg.locator('text[aria-label^="Programs"]')).toHaveCount(0)

    const geometry = await svg.evaluate((element) => {
      const rects = [...element.querySelectorAll(':scope > rect')].map((rect) => ({
        x: Number(rect.getAttribute('x') ?? 0),
        y: Number(rect.getAttribute('y') ?? 0),
        width: Number(rect.getAttribute('width') ?? 0),
        height: Number(rect.getAttribute('height') ?? 0),
        fill: rect.getAttribute('fill'),
        stroke: rect.getAttribute('stroke'),
        strokeWidth: Number(rect.getAttribute('stroke-width') ?? 0),
      }))
      const texts = [...element.querySelectorAll(':scope > text')].map((text) => {
        const bounds = (text as SVGGraphicsElement).getBBox()
        return {
          label: text.getAttribute('aria-label'),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        }
      })
      const viewBox = (element as SVGSVGElement).viewBox.baseVal
      return { width: viewBox.width, height: viewBox.height, rects, texts }
    })
    const windowFrame = geometry.rects.find(({ fill, stroke, strokeWidth }) => fill === '#c0c0c0' && stroke === '#000000' && strokeWidth === 2)
    const clientArea = geometry.rects.find(({ fill, stroke }) => fill === '#ffffff' && stroke === '#808080')
    const statusBar = geometry.rects.find(({ fill, stroke, height }) => fill === '#c0c0c0' && stroke === '#ffffff' && height === 18)
    const statusText = geometry.texts.find(({ label }) => label === '3 items')
    const welcomeText = geometry.texts.find(({ label }) => label === 'Welcome to the live SVG window layout check')
    expect(windowFrame).toBeDefined()
    expect(clientArea).toBeDefined()
    expect(statusBar).toBeDefined()
    expect(statusText).toBeDefined()
    expect(welcomeText).toBeDefined()
    if (!windowFrame || !clientArea || !statusBar || !statusText || !welcomeText) return

    expect(windowFrame.x).toBeGreaterThanOrEqual(0)
    expect(windowFrame.y).toBeGreaterThanOrEqual(0)
    expect(windowFrame.x + windowFrame.width).toBeLessThanOrEqual(geometry.width)
    expect(windowFrame.y + windowFrame.height).toBeLessThanOrEqual(geometry.height)
    expect(geometry.rects.some(({ fill, width }) => fill === '#c0c0c0' && width > geometry.width - 40)).toBe(false)
    expect(statusBar.y).toBeGreaterThanOrEqual(clientArea.y + clientArea.height)
    expect(statusBar.y + statusBar.height).toBeLessThanOrEqual(windowFrame.y + windowFrame.height)
    expect(windowFrame.y + windowFrame.height - statusBar.y - statusBar.height).toBeGreaterThanOrEqual(8)
    expect(windowFrame.y + windowFrame.height - statusBar.y - statusBar.height).toBeLessThanOrEqual(12)
    expect(statusText.x).toBeGreaterThanOrEqual(statusBar.x)
    expect(statusText.x + statusText.width).toBeLessThanOrEqual(statusBar.x + statusBar.width)
    expect(welcomeText.x).toBeGreaterThanOrEqual(clientArea.x)
    expect(welcomeText.x + welcomeText.width).toBeLessThanOrEqual(clientArea.x + clientArea.width)

    const screenshotPath = testInfo.outputPath('win95-window-live-render.png')
    await desktop.page.screenshot({ path: screenshotPath, fullPage: true })
    await testInfo.attach('win95-window-live-render', { path: screenshotPath, contentType: 'image/png' })
  })
})
