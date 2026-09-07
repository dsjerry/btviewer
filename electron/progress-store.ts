import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { WatchProgress } from '../src/types'

// 观看进度持久化：key 为 infoHash:filePath，看完或不足 5s 的记录会被清除
const progressFile = () => join(app.getPath('userData'), 'progress.json')
let cache: Record<string, WatchProgress> | null = null

function loadAll(): Record<string, WatchProgress> {
  if (cache) return cache
  try { cache = JSON.parse(readFileSync(progressFile(), 'utf8')) as Record<string, WatchProgress> } catch { cache = {} }
  return cache
}

const progressKey = (infoHash: string, filePath: string) => `${infoHash.toLowerCase()}:${filePath}`

export function getProgress(infoHash: string, filePath: string): WatchProgress | null {
  return loadAll()[progressKey(infoHash, filePath)] || null
}

export function setProgress(infoHash: string, filePath: string, position: number, duration: number) {
  const all = loadAll()
  const key = progressKey(infoHash, filePath)
  if (!Number.isFinite(position) || position < 5) {
    // 开头片段或已看完（调用方传 0）的进度不值得恢复
    if (all[key]) { delete all[key]; persist() }
    return
  }
  all[key] = { position, duration: Number.isFinite(duration) ? duration : 0, updatedAt: Date.now() }
  persist()
}

function persist() {
  try { writeFileSync(progressFile(), JSON.stringify(cache, null, 2)) } catch { /* 写盘失败只影响下次续播 */ }
}
