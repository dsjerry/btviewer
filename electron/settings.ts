import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface AppSettings {
  downloadDir?: string
  trackers?: string
  maxConcurrentDownloads?: number
}

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as AppSettings } catch { return {} }
}

export function saveSettings(settings: AppSettings) {
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
}
