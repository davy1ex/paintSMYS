import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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

  const projectRoot = result.filePaths[0]
  try {
    const manifestText = await readFile(join(projectRoot, 'project.json'), 'utf8')
    return { status: 'loaded', manifestText, projectRoot }
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
    if (code === 'ENOENT') {
      return { status: 'error', message: 'The selected folder does not contain project.json.' }
    }
    return { status: 'error', message: 'The project manifest could not be read.' }
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
