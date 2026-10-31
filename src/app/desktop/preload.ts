import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('paintSMYS', {
  platform: process.platform,
  windowControls: {
    minimize: () => ipcRenderer.send('paintSMYS:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('paintSMYS:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('paintSMYS:window-control', 'close'),
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('paintSMYS:maximized-changed', listener)
      return () => ipcRenderer.removeListener('paintSMYS:maximized-changed', listener)
    },
  },
})
