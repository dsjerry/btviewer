import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface AppSettings {
  downloadDir?: string
  trackers?: string
  maxConcurrentDownloads?: number
  speedLimit?: string
  theme?: 'light' | 'dark' | 'system'
  // 关闭窗口时是否隐藏到托盘；缺省视为开启
  closeToTray?: boolean
  // 开机自启（真实状态以系统登录项为准，此处仅作回显缓存）
  launchOnStartup?: boolean
  // 下载完成桌面通知；缺省视为开启
  notifyOnComplete?: boolean
}

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as AppSettings } catch { return {} }
}

export function saveSettings(settings: AppSettings) {
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
}
