import { randomUUID } from 'node:crypto'
import { mkdir, open, lstat, readFile, realpath, rename, rmdir, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseProjectManifest, serializeProjectManifest, createProjectManifest, type ProjectManifest } from '../../core/project/project-manifest'

export type SaveAsTarget =
  | { status: 'new'; projectRoot: string; projectName: string }
  | { status: 'existing-project'; projectRoot: string; projectName: string }

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null
}

function asErrorMessage(error: unknown): string {
  if (errorCode(error) === 'EACCES' || errorCode(error) === 'EPERM' || errorCode(error) === 'EROFS') {
    return 'You do not have permission to save in this location.'
  }
  if (errorCode(error) === 'ENOSPC') return 'There is not enough disk space to save the project.'
  return error instanceof Error ? error.message : 'The project could not be saved.'
}

function projectManifestWithName(manifestText: string, projectName: string): ProjectManifest {
  const manifest = parseProjectManifest(manifestText)
  return createProjectManifest(manifest.project.id, projectName, manifest.scene)
}

async function canonicalProjectRoot(path: string): Promise<string> {
  const root = await realpath(resolve(path))
  const rootInfo = await lstat(root)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('The project location must be a directory.')
  }
  return root
}

async function readExistingProjectManifest(projectRoot: string): Promise<ProjectManifest> {
  const manifestPath = join(projectRoot, 'project.json')
  let info
  try {
    info = await lstat(manifestPath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') throw new Error('This folder is not a saved paintSMYS project.')
    throw error
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('project.json must be a regular file inside the project folder.')
  }
  return parseProjectManifest(await readFile(manifestPath, 'utf8'))
}

async function ensureAssetsDirectory(projectRoot: string): Promise<boolean> {
  const assetsPath = join(projectRoot, 'assets')
  try {
    const info = await lstat(assetsPath)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new Error('The project assets path must be a directory inside the project folder.')
    }
    return false
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    await mkdir(assetsPath)
    return true
  }
}

async function writeManifestAtomically(projectRoot: string, manifest: ProjectManifest): Promise<void> {
  const manifestPath = join(projectRoot, 'project.json')
  const tempPath = join(projectRoot, `.project-${randomUUID()}.tmp`)
  const text = serializeProjectManifest(manifest)
  let tempFile: Awaited<ReturnType<typeof open>> | null = null

  try {
    tempFile = await open(tempPath, 'wx', 0o600)
    await tempFile.writeFile(text, 'utf8')
    await tempFile.sync()
    await tempFile.close()
    tempFile = null
    await rename(tempPath, manifestPath)

    // Persist the directory entry where the platform supports syncing directories.
    let directory: Awaited<ReturnType<typeof open>> | null = null
    try {
      directory = await open(projectRoot, 'r')
      await directory.sync()
    } catch {
      // Some platforms do not allow opening or syncing directories.
    } finally {
      if (directory) await directory.close().catch(() => undefined)
    }
  } finally {
    if (tempFile) await tempFile.close().catch(() => undefined)
    await unlink(tempPath).catch(() => undefined)
  }
}

export async function inspectSaveAsTarget(selectedPath: string): Promise<SaveAsTarget> {
  const absolutePath = resolve(selectedPath)
  const projectName = basename(absolutePath)
  if (!projectName || projectName === '.' || projectName === '..') {
    throw new Error('Choose a valid project folder name.')
  }

  const parent = await realpath(dirname(absolutePath))
  const projectRoot = join(parent, projectName)
  let info
  try {
    info = await lstat(projectRoot)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { status: 'new', projectRoot, projectName }
    throw error
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('A file already exists at the selected project location.')
  }
  await readExistingProjectManifest(projectRoot)
  return { status: 'existing-project', projectRoot, projectName }
}

export async function readProjectFolder(projectPath: string): Promise<{ projectRoot: string; manifestText: string }> {
  const projectRoot = await canonicalProjectRoot(projectPath)
  await readExistingProjectManifest(projectRoot)
  return { projectRoot, manifestText: await readFile(join(projectRoot, 'project.json'), 'utf8') }
}

export async function saveProjectAsFolder(
  selectedPath: string,
  manifestText: string,
  allowOverwriteExistingProject: boolean,
): Promise<{ projectRoot: string; projectName: string }> {
  const target = await inspectSaveAsTarget(selectedPath)
  if (target.status === 'existing-project' && !allowOverwriteExistingProject) {
    throw new Error('A paintSMYS project already exists in that folder.')
  }

  const manifest = projectManifestWithName(manifestText, target.projectName)
  let createdRoot = false
  let createdAssets = false
  try {
    if (target.status === 'new') {
      await mkdir(target.projectRoot)
      createdRoot = true
    } else {
      await readExistingProjectManifest(target.projectRoot)
    }
    createdAssets = await ensureAssetsDirectory(target.projectRoot)
    await writeManifestAtomically(target.projectRoot, manifest)
    return { projectRoot: target.projectRoot, projectName: target.projectName }
  } catch (error) {
    // rmdir only removes directories that are still empty; it cannot remove user files.
    if (createdAssets) await rmdir(join(target.projectRoot, 'assets')).catch(() => undefined)
    if (createdRoot) await rmdir(target.projectRoot).catch(() => undefined)
    throw new Error(asErrorMessage(error))
  }
}

export async function saveExistingProjectFolder(
  projectPath: string,
  manifestText: string,
): Promise<{ projectRoot: string; projectName: string }> {
  let projectRoot: string
  try {
    projectRoot = await canonicalProjectRoot(projectPath)
    await readExistingProjectManifest(projectRoot)
    const manifest = projectManifestWithName(manifestText, parseProjectManifest(manifestText).project.name)
    await ensureAssetsDirectory(projectRoot)
    await writeManifestAtomically(projectRoot, manifest)
    return { projectRoot, projectName: manifest.project.name }
  } catch (error) {
    throw new Error(asErrorMessage(error))
  }
}
