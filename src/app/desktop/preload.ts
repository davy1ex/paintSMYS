import { contextBridge, ipcRenderer } from 'electron'
import type { ProjectSaveRequest, ProjectSaveSelection } from '../../application/project-save-port'
import type { ProjectOpenSelection } from '../../application/project-open-port'
import type { PngExportRequest, PngExportSelection } from '../../application/export-png-port'
import type { PluginCatalog } from '../../application/plugins/plugin-api'

contextBridge.exposeInMainWorld('paintSMYS', {
  platform: process.platform,
  openProject: () => ipcRenderer.invoke('paintSMYS:open-project') as Promise<ProjectOpenSelection>,
  saveProject: (request: ProjectSaveRequest) => ipcRenderer.invoke('paintSMYS:save-project', request) as Promise<ProjectSaveSelection>,
  exportPng: (request: PngExportRequest) => ipcRenderer.invoke('paintSMYS:export-png', request) as Promise<PngExportSelection>,
  listPlugins: () => ipcRenderer.invoke('paintSMYS:list-plugins') as Promise<PluginCatalog>,
  windowControls: {
    minimize: () => ipcRenderer.send('paintSMYS:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('paintSMYS:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('paintSMYS:window-control', 'close'),
    respondToCloseRequest: (requestId: number, decision: 'allow' | 'cancel') => {
      ipcRenderer.send('paintSMYS:close-decision', { requestId, decision })
    },
    acknowledgeCloseRequest: (requestId: number) => {
      ipcRenderer.send('paintSMYS:close-acknowledge', requestId)
    },
    isMaximized: () => ipcRenderer.invoke('paintSMYS:is-maximized') as Promise<boolean>,
    onMaximizedChange: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('paintSMYS:maximized-changed', listener)
      return () => ipcRenderer.removeListener('paintSMYS:maximized-changed', listener)
    },
    onCloseRequest: (callback: (requestId: number) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, requestId: number) => callback(requestId)
      ipcRenderer.on('paintSMYS:close-request', listener)
      return () => ipcRenderer.removeListener('paintSMYS:close-request', listener)
    },
    onCloseRequestFailure: (callback: (request: { requestId: number; message: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, request: { requestId: number; message: string }) => callback(request)
      ipcRenderer.on('paintSMYS:close-request-failed', listener)
      return () => ipcRenderer.removeListener('paintSMYS:close-request-failed', listener)
    },
  },
})
