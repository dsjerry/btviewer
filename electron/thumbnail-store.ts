import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { writeJsonAtomic } from './storage'

// 缩略图持久化：key 为 `infoHash:filePath`，value 为 dataURL（与 progress-store 同款模式）
const MAX_ENTRIES = 400
const MAX_VALUE_LENGTH = 200 * 1024

const file = () => join(app.getPath('userData'), 'thumbnails.json')
let cache: Record<string, string> | null = null

function load(): Record<string, string> {
  if (cache) return cache
  try { cache = JSON.parse(readFileSync(file(), 'utf8')) as Record<string, string> } catch { cache = {} }
  return cache
}

export function getThumbnails(keys: string[]): Array<string | null> {
  const store = load()
  return keys.map((key) => store[key] ?? null)
}

export function saveThumbnail(key: string, dataUrl: string) {
  if (!key || !dataUrl.startsWith('data:image/') || dataUrl.length > MAX_VALUE_LENGTH) return
  const store = load()
  store[key] = dataUrl
  // 超上限时丢弃最早写入的条目（对象键序即插入序）
  const keys = Object.keys(store)
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) delete store[stale]
  try { writeJsonAtomic(file(), store) } catch { /* 写盘失败不影响主流程 */ }
}
