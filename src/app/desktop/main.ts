import { app, BrowserWindow, ipcMain } from 'electron'
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
