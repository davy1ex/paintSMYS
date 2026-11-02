export type ProjectSaveMode = 'save' | 'save-as'

export type ProjectSaveRequest = {
  manifestText: string
  projectName: string
  projectRoot: string | null
  mode: ProjectSaveMode
}

export type ProjectSaveSelection =
  | { status: 'cancelled' }
  | { status: 'error'; message: string }
  | { status: 'saved'; projectRoot: string; projectName: string }

export type ProjectSavePort = {
  saveProject: (request: ProjectSaveRequest) => Promise<ProjectSaveSelection>
}
