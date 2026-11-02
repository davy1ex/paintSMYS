export type CloseDecision = 'allow' | 'cancel'

type CloseHandshakeOptions = {
  requestRendererDecision: (requestId: number) => void
  closeWindow: () => void
  onFailure: (requestId: number, message: string) => void
  timeoutMs?: number
}

/** Bridges Electron's synchronous close event to an asynchronous renderer decision. */
export class CloseHandshake {
  private requestSequence = 0
  private pendingRequest: { id: number; timer: ReturnType<typeof setTimeout> } | null = null
  private allowNextClose = false
  private readonly timeoutMs: number

  constructor(private readonly options: CloseHandshakeOptions) {
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** Returns true only when the current close event may continue. */
  handleClose(): boolean {
    if (this.allowNextClose) {
      this.allowNextClose = false
      return true
    }

    if (this.pendingRequest) return false

    const requestId = ++this.requestSequence
    const timer = setTimeout(() => {
      this.failRequest(requestId, 'The editor did not respond to the close request. The window was kept open.')
    }, this.timeoutMs)
    this.pendingRequest = { id: requestId, timer }

    try {
      this.options.requestRendererDecision(requestId)
    } catch {
      this.failRequest(requestId, 'The close request could not reach the editor. The window was kept open.')
    }

    return false
  }

  respond(requestId: number, decision: CloseDecision): void {
    if (this.pendingRequest?.id !== requestId) return
    clearTimeout(this.pendingRequest.timer)
    this.pendingRequest = null

    if (decision === 'cancel') return

    this.allowNextClose = true
    try {
      this.options.closeWindow()
    } catch {
      this.allowNextClose = false
      this.notifyFailure(requestId, 'The window could not be closed. Your project remains open.')
    }
  }

  private failRequest(requestId: number, message: string): void {
    if (this.pendingRequest?.id !== requestId) return
    clearTimeout(this.pendingRequest.timer)
    this.pendingRequest = null
    this.notifyFailure(requestId, message)
  }

  private notifyFailure(requestId: number, message: string): void {
    try {
      this.options.onFailure(requestId, message)
    } catch {
      // Failure reporting must not turn a rejected close request into an allowed one.
    }
  }
}
