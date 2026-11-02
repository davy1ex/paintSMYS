import type { PluginHost, PluginRuntime } from '../../../application/plugins/plugin-api'
import { IsolatedPluginRuntime } from './isolated-plugin-runtime'

export function createDesktopPluginRuntime(host: PluginHost): PluginRuntime {
  return new IsolatedPluginRuntime(async () => {
    const api = window.paintSMYS
    if (!api) throw new Error('The desktop plugin bridge is unavailable.')
    return api.listPlugins()
  }, host)
}
