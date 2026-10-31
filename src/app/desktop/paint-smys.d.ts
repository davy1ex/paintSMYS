interface Window {
  paintSMYS?: {
    platform: string
    windowControls: {
      minimize: () => void
      toggleMaximize: () => void
      close: () => void
      onMaximizedChange: (callback: (maximized: boolean) => void) => () => void
    }
  }
}
