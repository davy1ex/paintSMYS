import type { ProjectOpenPort } from '../../application/project-open-port'
import type { ProjectSavePort } from '../../application/project-save-port'

export const desktopProjectAdapter: ProjectOpenPort & ProjectSavePort = {
  openProject: async () => {
    if (!window.paintSMYS) {
      return { status: 'error', message: 'Desktop project access is unavailable.' }
    }
    return window.paintSMYS.openProject()
  },
  saveProject: async (request) => {
    if (!window.paintSMYS) {
      return { status: 'error', message: 'Desktop project access is unavailable.' }
    }
    return window.paintSMYS.saveProject(request)
  },
}
