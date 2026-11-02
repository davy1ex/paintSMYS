export type ProjectOpenSelection =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; manifestText: string; projectRoot: string | null }

export type ProjectOpenPort = {
  openProject: () => Promise<ProjectOpenSelection>
}
