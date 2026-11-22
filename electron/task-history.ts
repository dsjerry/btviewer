// 任务历史留档：任务完成 / 被移除时追加一条，补 tasks.json 不存的运行期字段
// （saveDir / 大小 / 上传量），让「之前下过什么、存在哪」在任务移除后仍可查。
// 存储：userData/task-history.json，最近 MAX_ENTRIES 条；变更返回完整列表（沿 media-collections 模式）。
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { TaskHistoryEntry } from '../src/types'
import { writeJsonAtomic } from './storage'
import { logger } from './logger'

const historyFile = () => join(app.getPath('userData'), 'task-history.json')
const MAX_ENTRIES = 200
let cache: TaskHistoryEntry[] | null = null

const lastEvent = (entry: TaskHistoryEntry) => entry.removedAt ?? entry.completedAt ?? entry.addedAt ?? 0

function isEntry(value: unknown): value is TaskHistoryEntry {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<TaskHistoryEntry>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.type === 'string' && typeof candidate.source === 'string'
}

function loadAll(): TaskHistoryEntry[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(historyFile(), 'utf8')) as unknown
    cache = Array.isArray(parsed) ? parsed.filter(isEntry) : []
  } catch { cache = [] }
  return cache
}

function persist(entries: TaskHistoryEntry[]) {
  cache = entries
  writeJsonAtomic(historyFile(), entries, 2)
}

export function listTaskHistory(): TaskHistoryEntry[] {
  return loadAll().slice().sort((a, b) => lastEvent(b) - lastEvent(a))
}

export type TaskHistoryDraft = Pick<TaskHistoryEntry, 'id' | 'name' | 'type' | 'source'> & Partial<Omit<TaskHistoryEntry, 'id' | 'name' | 'type' | 'source'>>

// 同 id 合并：完成任务补 completedAt，移除补 removedAt/destroy；新条目插入头部并按 MAX_ENTRIES 裁最老
export function recordTaskHistory(entry: TaskHistoryDraft): TaskHistoryEntry[] {
  if (!entry?.id || !entry.name || !entry.type || !entry.source) throw new Error('任务历史条目无效')
  const list = loadAll()
  const index = list.findIndex((item) => item.id === entry.id)
  if (index >= 0) {
    list[index] = { ...list[index], ...entry }
  } else {
    list.unshift({ ...entry })
    if (list.length > MAX_ENTRIES) {
      const stale = [...list].sort((a, b) => lastEvent(a) - lastEvent(b)).slice(0, list.length - MAX_ENTRIES)
      const staleIds = new Set(stale.map((item) => item.id))
      for (const item of staleIds) {
        const target = list.findIndex((candidate) => candidate.id === item)
        if (target >= 0) list.splice(target, 1)
      }
    }
  }
  persist(list)
  return listTaskHistory()
}

export function clearTaskHistory(): TaskHistoryEntry[] {
  persist([])
  logger.info('task-history', 'history cleared')
  return listTaskHistory()
}
