import type { ProjectOpenPort } from '../../application/project-open-port'

export const desktopProjectAdapter: ProjectOpenPort = {
  openProject: async () => {
    if (!window.paintSMYS) {
      return { status: 'error', message: 'Desktop project access is unavailable.' }
    }
    return window.paintSMYS.openProject()
  },
}
