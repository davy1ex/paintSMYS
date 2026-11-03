import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDesktopE2eLaunchConfig } from '../src/app/desktop/desktop-e2e-launch-config'

const tempRoot = join(tmpdir(), 'paintsmys-desktop-e2e-policy-test')
const userDataPath = join(tempRoot, 'user-data')
const dialogDirectory = join(tempRoot, 'dialogs')
const validArgs = [
  '--paint-smys-e2e',
  `--paint-smys-user-data=${userDataPath}`,
  `--paint-smys-e2e-dialog-dir=${dialogDirectory}`,
]

test('packaged applications never accept Desktop E2E path overrides', () => {
  assert.equal(getDesktopE2eLaunchConfig(true, validArgs), null)
})

test('unpackaged launches require the dedicated marker and both explicit paths', () => {
  assert.equal(getDesktopE2eLaunchConfig(false, validArgs.slice(1)), null)
  assert.equal(getDesktopE2eLaunchConfig(false, validArgs.slice(0, 2)), null)
  assert.equal(getDesktopE2eLaunchConfig(false, [...validArgs, validArgs[0]!]), null)
})

test('only the temporary E2E profile layout enables the dialog fixture', () => {
  assert.deepEqual(getDesktopE2eLaunchConfig(false, validArgs), {
    userDataPath,
    dialogDirectory,
    projectPath: join(dialogDirectory, 'Saved Project'),
  })
  assert.equal(getDesktopE2eLaunchConfig(false, [
    '--paint-smys-e2e',
    '--paint-smys-user-data=/home/user/.config/paintSMYS',
    '--paint-smys-e2e-dialog-dir=/home/user/Documents',
  ]), null)
})

test('relative or duplicate path arguments are rejected', () => {
  assert.equal(getDesktopE2eLaunchConfig(false, [
    '--paint-smys-e2e',
    '--paint-smys-user-data=./user-data',
    `--paint-smys-e2e-dialog-dir=${dialogDirectory}`,
  ]), null)
  assert.equal(getDesktopE2eLaunchConfig(false, [
    ...validArgs,
    `--paint-smys-e2e-dialog-dir=${dialogDirectory}`,
  ]), null)
})
