import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logger } from './logger'
import type { UpdaterEvent } from '../src/types'

type SendEvent = (event: UpdaterEvent) => void

function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }

let send: SendEvent | null = null

// 打包后启用自动更新：公共仓库无需 token，直接读取 GitHub Releases 里的 latest*.yml
// 策略：启动后自动检查并后台下载，下载完成后由用户决定何时重启安装；忽略时退出时自动安装
export function initUpdater(sender: SendEvent, delayMs = 3000) {
  if (!app.isPackaged) return
  send = sender
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => send?.({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => send?.({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', (info) => send?.({ type: 'not-available', version: info.version }))
  autoUpdater.on('download-progress', (progress) => send?.({ type: 'progress', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => send?.({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => {
    logger.error('updater', getErrorMessage(error))
    // 静默检查失败不弹横幅，只写日志；手动检查的错误走 IPC 返回值
  })
  // 稍等渲染层完成事件订阅后再做首次检查
  setTimeout(() => { void checkForUpdates().catch((error) => logger.error('updater', `initial check failed: ${getErrorMessage(error)}`)) }, delayMs)
}

// 手动检查：渲染层"检查更新"按钮；错误抛给调用方展示
export async function checkForUpdates() {
  if (!app.isPackaged) throw new Error('开发模式不支持自动更新，请使用 npm run dev 调试')
  return autoUpdater.checkForUpdates()
}

export function installUpdate() {
  // 用户确认后退出并安装；已在队列里时立即生效
  autoUpdater.quitAndInstall()
}
