import type { ProjectOpenSelection } from '../../application/project-open-port'
import type { ProjectSaveRequest, ProjectSaveSelection } from '../../application/project-save-port'

declare global {
  interface Window {
    paintSMYS?: {
      platform: string
      openProject: () => Promise<ProjectOpenSelection>
      saveProject: (request: ProjectSaveRequest) => Promise<ProjectSaveSelection>
      windowControls: {
        minimize: () => void
        toggleMaximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
        onCloseRequest: (callback: (requestId: number) => void) => () => void
        onCloseRequestFailure: (callback: (request: { requestId: number; message: string }) => void) => () => void
        respondToCloseRequest: (requestId: number, decision: 'allow' | 'cancel') => void
      }
    }
  }
}

export {}
