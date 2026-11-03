import { _electron as electron, expect, test as base, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'

type DesktopOptions = { installCodeCard: boolean }
type DesktopHarness = {
  app: ElectronApplication
  page: Page
  userDataDir: string
  dialogDir: string
  close: () => Promise<void>
  processExitReason: () => string | null
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
    await mkdir(userDataDir, { recursive: true })
    await mkdir(dialogDir, { recursive: true })

    if (desktopOptions.installCodeCard) {
      const installedPluginDir = join(userDataDir, 'plugins', 'code-card')
      await mkdir(installedPluginDir, { recursive: true })
      await copyFile(resolve('examples/plugins/code-card/manifest.json'), join(installedPluginDir, 'manifest.json'))
      await copyFile(resolve('examples/plugins/code-card/index.js'), join(installedPluginDir, 'index.js'))
    }

    const diagnosticLines: string[] = []
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
        if (message.type() === 'error') appendDiagnostic(`Renderer console.error: ${message.text()}`)
      })
      page.on('pageerror', (error) => appendDiagnostic(`Renderer pageerror: ${error.stack ?? error.message}`))
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
        close,
        processExitReason: () => processExit,
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

async function fillCodeCard(page: Page, sourceCode: string) {
  await page.getByLabel('Window title').fill('paintSMYS E2E')
  await page.getByLabel('Language').selectOption('python')
  await page.getByLabel('Source code').fill(sourceCode)
  await page.getByRole('button', { name: 'Generate', exact: true }).click()
}

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
})
