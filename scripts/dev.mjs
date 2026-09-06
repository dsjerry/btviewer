import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Electron treats ELECTRON_RUN_AS_NODE= (empty) as "set" and runs in Node mode,
// where `electron.app` is undefined. cross-env cannot unset variables, so we
// delete it here before launching electron-vite.
delete process.env.ELECTRON_RUN_AS_NODE

const require = createRequire(import.meta.url)
const cli = join(require.resolve('electron-vite/package.json'), '..', 'bin', 'electron-vite.js')

const child = spawn(process.execPath, [cli, 'dev', '--', '--no-sandbox', '--disable-gpu'], {
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code) => process.exit(code ?? 0))
