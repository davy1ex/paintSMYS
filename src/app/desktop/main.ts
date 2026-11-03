import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PngExportRequest } from '../../application/export-png-port'
import { loadInstalledPlugins } from './plugin-loader'
import { getDesktopE2eLaunchConfig } from './desktop-e2e-launch-config'
import { inspectSaveAsTarget, readProjectFolder, saveExistingProjectFolder, saveProjectAsFolder } from './project-storage'
import { exportPngFile } from './png-export'
import { CloseHandshake } from './window/close-handshake'

const projectRoots = new WeakMap<WebContents, string>()
const closeHandshakes = new WeakMap<BrowserWindow, CloseHandshake>()
const pngExportDialogs = new WeakSet<BrowserWindow>()
const closeAfterPngExportDialog = new WeakSet<BrowserWindow>()
const trustedRendererUrls = new WeakMap<WebContents, string>()

// Overrides are accepted only for the unpackaged Playwright fixture's explicit
// temporary profile layout. Installed applications always use native dialogs.
const desktopE2eLaunchConfig = getDesktopE2eLaunchConfig(app.isPackaged, process.argv)
if (desktopE2eLaunchConfig) app.setPath('userData', desktopE2eLaunchConfig.userDataPath)
const desktopE2eProjectPath = desktopE2eLaunchConfig?.projectPath ?? null

function showProjectOpenDialog(owner: BrowserWindow) {
  if (desktopE2eProjectPath) return Promise.resolve({ canceled: false, filePaths: [desktopE2eProjectPath] })
  return dialog.showOpenDialog(owner, {
    title: 'Open paintSMYS Project',
    properties: ['openDirectory'],
  })
}

function showProjectSaveDialog(owner: BrowserWindow, projectName: string) {
  if (desktopE2eProjectPath) return Promise.resolve({ canceled: false, filePath: desktopE2eProjectPath })
  return dialog.showSaveDialog(owner, {
    title: 'Save paintSMYS Project As',
    buttonLabel: 'Create Project',
    nameFieldLabel: 'Project folder name:',
    defaultPath: join(app.getPath('documents'), projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Untitled'),
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The project operation failed.'
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    title: 'paintSMYS',
    backgroundColor: '#c0c0c0',
    frame: process.platform !== 'linux',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  const sendMaximizedState = () => {
    window.webContents.send('paintSMYS:maximized-changed', window.isMaximized())
  }

  let lastFailureDialogRequestId: number | null = null
  const showCloseFailureDialog = (requestId: number, message: string) => {
    if (window.isDestroyed() || lastFailureDialogRequestId === requestId) return
    lastFailureDialogRequestId = requestId
    void dialog.showMessageBox(window, {
      type: 'warning',
      title: 'paintSMYS is not responding',
      message: 'The editor did not respond to the close request.',
      detail: `${message}\n\nForce closing may discard unsaved changes.`,
      buttons: ['Keep Open', 'Force Close'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    }).then(({ response }) => {
      if (response === 1 && !window.isDestroyed()) window.destroy()
    }).catch(() => undefined)
  }

  const closeHandshake = new CloseHandshake({
    requestRendererDecision: (requestId) => window.webContents.send('paintSMYS:close-request', requestId),
    closeWindow: () => window.close(),
    onFailure: (requestId, message) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
          window.webContents.send('paintSMYS:close-request-failed', { requestId, message })
        } catch {
          // Keep the native fallback available if renderer IPC has failed.
        }
      }
      showCloseFailureDialog(requestId, message)
    },
  })
  closeHandshakes.set(window, closeHandshake)

  window.webContents.on('unresponsive', () => {
    const requestId = closeHandshake.pendingRequestId()
    if (requestId !== null) {
      showCloseFailureDialog(requestId, 'The editor window is not responding.')
    }
  })

  window.on('close', (event) => {
    if (pngExportDialogs.has(window)) {
      event.preventDefault()
      closeAfterPngExportDialog.add(window)
      return
    }
    if (!closeHandshake.handleClose()) event.preventDefault()
  })
  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
  const expectedRendererUrl = rendererUrl
    ? new URL('desktop.html', rendererUrl).toString()
    : pathToFileURL(join(__dirname, '../renderer/desktop.html')).toString()
  const expectedPluginRuntimeUrl = new URL('plugin-runtime.html', expectedRendererUrl).toString()
  trustedRendererUrls.set(window.webContents, expectedRendererUrl)
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (navigationUrl !== expectedRendererUrl) event.preventDefault()
  })
  window.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) {
      if (event.url !== expectedRendererUrl) event.preventDefault()
      return
    }
    if (event.url !== expectedPluginRuntimeUrl && event.url !== 'about:blank') event.preventDefault()
  })
  if (rendererUrl) {
    void window.loadURL(new URL('desktop.html', rendererUrl).toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/desktop.html'))
  }
}

ipcMain.on('paintSMYS:window-control', (event, action: unknown) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window) return

  if (action === 'minimize') {
    window.minimize()
  } else if (action === 'toggle-maximize') {
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  } else if (action === 'close') {
    window.close()
  }
})

ipcMain.on('paintSMYS:close-decision', (event, payload: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || typeof payload !== 'object' || payload === null) return
  if (!('requestId' in payload) || !('decision' in payload)) return
  const requestId = payload.requestId
  const decision = payload.decision
  if (!Number.isSafeInteger(requestId) || (decision !== 'allow' && decision !== 'cancel')) return

  // The single window owns this handler instance; stale IDs are ignored by the handshake.
  const handshake = closeHandshakes.get(owner)
  handshake?.respond(requestId as number, decision)
})

ipcMain.on('paintSMYS:close-acknowledge', (event, requestId: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || event.senderFrame !== event.sender.mainFrame || !Number.isSafeInteger(requestId)) return
  closeHandshakes.get(owner)?.acknowledge(requestId as number)
})

ipcMain.handle('paintSMYS:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
})

ipcMain.handle('paintSMYS:list-plugins', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner || event.senderFrame !== event.sender.mainFrame || event.senderFrame.url !== trustedRendererUrls.get(event.sender)) {
    return { plugins: [], errors: ['Plugins can only be loaded by the paintSMYS editor window.'] }
  }
  return loadInstalledPlugins(join(app.getPath('userData'), 'plugins'))
})

ipcMain.handle('paintSMYS:open-project', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) return { status: 'error', message: 'The application window is unavailable.' }

  const result = await showProjectOpenDialog(owner)
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }

  try {
    const { projectRoot, manifestText } = await readProjectFolder(result.filePaths[0])
    projectRoots.set(event.sender, projectRoot)
    return { status: 'loaded', manifestText, projectRoot }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
})

ipcMain.handle('paintSMYS:save-project', async (event, request: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) return { status: 'error', message: 'The application window is unavailable.' }
  if (typeof request !== 'object' || request === null || !('mode' in request) || !('manifestText' in request)) {
    return { status: 'error', message: 'The save request is invalid.' }
  }
  const payload = request as { mode: unknown; manifestText: unknown; projectName: unknown; projectRoot?: unknown }
  if (
    typeof payload.manifestText !== 'string' || typeof payload.projectName !== 'string' ||
    (payload.mode !== 'save' && payload.mode !== 'save-as')
  ) {
    return { status: 'error', message: 'The save request is invalid.' }
  }

  try {
    if (payload.mode === 'save-as') {
      const selection = await showProjectSaveDialog(owner, payload.projectName)
      if (selection.canceled || !selection.filePath) return { status: 'cancelled' }

      const target = await inspectSaveAsTarget(selection.filePath)
      let allowOverwrite = false
      if (target.status === 'existing-project') {
        const confirmation = await dialog.showMessageBox(owner, {
          type: 'warning',
          title: 'Replace Existing Project?',
          message: `A paintSMYS project already exists in “${target.projectRoot}”.`,
          detail: 'Replace its project.json? Other files in the folder will be left untouched.',
          buttons: ['Replace Project', 'Cancel'],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        })
        if (confirmation.response !== 0) return { status: 'cancelled' }
        allowOverwrite = true
      }

      const saved = await saveProjectAsFolder(selection.filePath, payload.manifestText, allowOverwrite)
      projectRoots.set(event.sender, saved.projectRoot)
      return { status: 'saved', ...saved }
    }

    const activeRoot = projectRoots.get(event.sender)
    if (!activeRoot || typeof payload.projectRoot !== 'string') {
      return { status: 'error', message: 'This project folder is no longer available. Use Save As to choose a location.' }
    }
    const requestedRoot = await realpath(payload.projectRoot)
    if (requestedRoot !== activeRoot) {
      return { status: 'error', message: 'The save target does not match the active project folder.' }
    }
    const saved = await saveExistingProjectFolder(activeRoot, payload.manifestText)
    projectRoots.set(event.sender, saved.projectRoot)
    return { status: 'saved', ...saved }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
})

ipcMain.handle('paintSMYS:export-png', async (event, request: unknown) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) return { status: 'error', message: 'The application window is unavailable.' }
  if (typeof request !== 'object' || request === null || !('projectName' in request) || !('pngBytes' in request)) {
    return { status: 'error', message: 'The PNG export request is invalid.' }
  }

  const payload = request as PngExportRequest
  if (typeof payload.projectName !== 'string' || payload.projectName.length > 256) {
    return { status: 'error', message: 'The PNG export request is invalid.' }
  }
  return exportPngFile(
    payload,
    async (defaultName) => {
      pngExportDialogs.add(owner)
      try {
        const selection = await dialog.showSaveDialog(owner, {
          title: 'Export Artboard as PNG',
          buttonLabel: 'Export PNG',
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          properties: ['showOverwriteConfirmation'],
        })
        return selection.canceled ? null : selection.filePath ?? null
      } finally {
        pngExportDialogs.delete(owner)
        if (closeAfterPngExportDialog.delete(owner) && !owner.isDestroyed()) owner.close()
      }
    },
    (filePath, bytes) => writeFile(filePath, bytes),
  )
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
