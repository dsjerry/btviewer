import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Electron treats ELECTRON_RUN_AS_NODE= (empty) as "set" and runs in Node mode,
// where `electron.app` is undefined. cross-env cannot unset variables, so we
// delete it here before launching electron-vite.
delete process.env.ELECTRON_RUN_AS_NODE

const require = createRequire(import.meta.url)
const cli = join(require.resolve('electron-vite/package.json'), '..', 'bin', 'electron-vite.js')

// 启动参数只按需追加：
// - --no-sandbox 仅 Linux 需要（容器/无 user namespace 的开发机），macOS/Windows 保持 Chromium 沙箱
// - --disable-gpu 会把合成、视频硬解（VideoToolbox/DXVA）、WebGL 全部打到软件回退，4K 片源卡顿且
//   stderr 会出现 ffmpeg_common / gles2 报错——真机调试不要开；需要复现软件渲染时设 BTVIEWER_DEV_DISABLE_GPU=1
const args = [cli, 'dev', '--']
if (process.platform === 'linux') args.push('--no-sandbox')
if (process.env.BTVIEWER_DEV_DISABLE_GPU) args.push('--disable-gpu')

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  env: process.env
})
child.on('exit', (code) => process.exit(code ?? 0))
