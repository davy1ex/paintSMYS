import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const headed = process.argv.includes('--headed')
const args = [
  resolve('node_modules/@playwright/test/cli.js'),
  'test',
  '--config=playwright.desktop.config.ts',
]
if (headed) args.push('--headed')

let command = process.execPath
let commandArgs = args
if (process.platform === 'linux' && !process.env.DISPLAY) {
  if (headed) {
    process.stderr.write('The headed Desktop command needs an active display. Start it from a desktop session, or use test:e2e:desktop to run under Xvfb.\n')
    process.exitCode = 1
  } else {
    command = 'xvfb-run'
    commandArgs = ['-a', process.execPath, ...args]
  }
}

if (process.exitCode !== 1) {
  const child = spawn(command, commandArgs, { stdio: 'inherit' })
  child.on('error', (error) => {
    process.stderr.write(`${error.message}\n`)
    if (error.code === 'ENOENT' && command === 'xvfb-run') {
      process.stderr.write('Install Xvfb or run this command from a session with DISPLAY set.\n')
    }
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) process.exitCode = 1
    else process.exitCode = code ?? 1
  })
}
