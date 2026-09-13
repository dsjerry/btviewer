import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { writeJsonAtomic } from './storage'
// 类型单一来源：AppSettings 定义在 src/types，主进程与渲染层共用
import type { AppSettings } from '../src/types'

export type { AppSettings }

const settingsFile = () => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): AppSettings {
  try { return JSON.parse(readFileSync(settingsFile(), 'utf8')) as AppSettings } catch { return {} }
}

export function saveSettings(settings: AppSettings) {
  writeJsonAtomic(settingsFile(), settings, 2)
}
