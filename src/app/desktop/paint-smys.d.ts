import type { ProjectOpenSelection } from '../../application/project-open-port'

declare global {
  interface Window {
    paintSMYS?: {
      platform: string
      openProject: () => Promise<ProjectOpenSelection>
      windowControls: {
        minimize: () => void
        toggleMaximize: () => void
        close: () => void
        isMaximized: () => Promise<boolean>
        onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
      }
    }
  }
}

export {}
