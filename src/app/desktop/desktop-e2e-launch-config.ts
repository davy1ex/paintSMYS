import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const E2E_MARKER = '--paint-smys-e2e'
const USER_DATA_PREFIX = '--paint-smys-user-data='
const DIALOG_DIRECTORY_PREFIX = '--paint-smys-e2e-dialog-dir='

export type DesktopE2eLaunchConfig = {
  userDataPath: string
  dialogDirectory: string
  projectPath: string
}

function uniqueAbsoluteArgument(argv: readonly string[], prefix: string): string | null {
  const matches = argv.filter((argument) => argument.startsWith(prefix))
  if (matches.length !== 1) return null
  const value = matches[0]?.slice(prefix.length)
  if (!value || !isAbsolute(value)) return null
  return resolve(value)
}

/**
 * Accept dialog and profile overrides only for an unpackaged Playwright launch
 * with the dedicated marker and the temporary directory layout from the E2E
 * fixture. No environment variable can activate or provide paths to this seam.
 */
export function getDesktopE2eLaunchConfig(
  isPackaged: boolean,
  argv: readonly string[],
): DesktopE2eLaunchConfig | null {
  if (isPackaged || argv.filter((argument) => argument === E2E_MARKER).length !== 1) return null

  const userDataPath = uniqueAbsoluteArgument(argv, USER_DATA_PREFIX)
  const dialogDirectory = uniqueAbsoluteArgument(argv, DIALOG_DIRECTORY_PREFIX)
  if (!userDataPath || !dialogDirectory) return null

  const tempRoot = dirname(userDataPath)
  if (
    basename(userDataPath) !== 'user-data' ||
    basename(dialogDirectory) !== 'dialogs' ||
    dirname(dialogDirectory) !== tempRoot ||
    !basename(tempRoot).startsWith('paintsmys-desktop-e2e-')
  ) return null

  return {
    userDataPath,
    dialogDirectory,
    projectPath: join(dialogDirectory, 'Saved Project'),
  }
}
