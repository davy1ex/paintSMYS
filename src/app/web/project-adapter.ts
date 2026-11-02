import type { ProjectOpenPort, ProjectOpenSelection } from '../../application/project-open-port'

type BrowserDirectoryHandle = {
  getFileHandle: (name: string) => Promise<{ getFile: () => Promise<File> }>
}

type DirectoryPickerWindow = Window & {
  showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>
}

function pickWithDirectoryInput(): Promise<ProjectOpenSelection> {
  return new Promise((resolve) => {
    const input = document.createElement('input') as HTMLInputElement & { webkitdirectory?: boolean }
    if (!('webkitdirectory' in input)) {
      resolve({ status: 'error', message: 'This browser does not support opening a project folder.' })
      return
    }

    input.type = 'file'
    input.webkitdirectory = true
    input.multiple = true
    input.addEventListener('cancel', () => resolve({ status: 'cancelled' }), { once: true })
    input.addEventListener('change', async () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) {
        resolve({ status: 'error', message: 'The selected folder does not contain project.json at its root.' })
        return
      }

      const manifest = files.find((file) => file.name === 'project.json' && file.webkitRelativePath.split('/').length === 2)
      if (!manifest) {
        resolve({ status: 'error', message: 'The selected folder does not contain project.json at its root.' })
        return
      }

      try {
        resolve({ status: 'loaded', manifestText: await manifest.text(), projectRoot: null })
      } catch {
        resolve({ status: 'error', message: 'The project manifest could not be read.' })
      }
    }, { once: true })
    input.click()
  })
}

async function openBrowserProject(): Promise<ProjectOpenSelection> {
  const directoryPicker = (window as DirectoryPickerWindow).showDirectoryPicker
  if (directoryPicker) {
    try {
      const directory = await directoryPicker()
      const manifest = await directory.getFileHandle('project.json')
      return { status: 'loaded', manifestText: await (await manifest.getFile()).text(), projectRoot: null }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return { status: 'cancelled' }
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return { status: 'error', message: 'The selected folder does not contain project.json.' }
      }
      return { status: 'error', message: 'The project folder could not be read.' }
    }
  }

  return pickWithDirectoryInput()
}

export const webProjectAdapter: ProjectOpenPort = {
  openProject: openBrowserProject,
}
