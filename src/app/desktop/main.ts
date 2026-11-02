import { app, BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectSaveAsTarget, readProjectFolder, saveExistingProjectFolder, saveProjectAsFolder } from './project-storage'

const projectRoots = new WeakMap<WebContents, string>()

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
    },
  })

  const sendMaximizedState = () => {
    window.webContents.send('paintSMYS:maximized-changed', window.isMaximized())
  }
  window.on('maximize', sendMaximizedState)
  window.on('unmaximize', sendMaximizedState)

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  const rendererUrl = process.env.ELECTRON_RENDERER_URL
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

ipcMain.handle('paintSMYS:is-maximized', (event) => {
  return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
})

ipcMain.handle('paintSMYS:open-project', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) return { status: 'error', message: 'The application window is unavailable.' }

  const result = await dialog.showOpenDialog(owner, {
    title: 'Open paintSMYS Project',
    properties: ['openDirectory'],
  })
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
      const selection = await dialog.showSaveDialog(owner, {
        title: 'Save paintSMYS Project As',
        buttonLabel: 'Create Project',
        nameFieldLabel: 'Project folder name:',
        defaultPath: join(app.getPath('documents'), payload.projectName.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/g, '').trim() || 'Untitled'),
      })
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
