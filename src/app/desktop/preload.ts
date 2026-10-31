import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('paintSMYS', {
  platform: process.platform,
})
