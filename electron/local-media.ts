// 媒体库的本地视频引用：把磁盘上的媒体文件登记进来（引用绝对路径，不复制文件），
// 持久化到 userData/local-media.json。播放、字幕扫描、兼容转码都按路径走流服务的 /local 路由。
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app, shell } from 'electron'
import type { LocalMediaEntry } from '../src/types'
import { writeJsonAtomic } from './storage'

const localMediaFile = () => join(app.getPath('userData'), 'local-media.json')
let cache: LocalMediaEntry[] | null = null

function loadAll(): LocalMediaEntry[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(localMediaFile(), 'utf8')) as LocalMediaEntry[]
    cache = Array.isArray(parsed) ? parsed.filter((entry) => entry && typeof entry.path === 'string') : []
  } catch { cache = [] }
  return cache
}

function persist(entries: LocalMediaEntry[]) {
  cache = entries
  writeJsonAtomic(localMediaFile(), entries)
}

// 列出全部引用（新加入的在前）；missing 现查，移动硬盘未挂载/文件被删时播放按钮据此禁用
export function listLocalMedia(): LocalMediaEntry[] {
  return loadAll()
    .slice()
    .sort((a, b) => b.addedAt - a.addedAt)
    .map((entry) => ({ ...entry, missing: !existsSync(entry.path) }))
}

// 追加引用：按路径去重（重复导入保留原 addedAt），返回合并后的完整列表
export function addLocalMediaEntries(entries: LocalMediaEntry[]): LocalMediaEntry[] {
  const all = loadAll()
  const byPath = new Map(all.map((entry) => [entry.path, entry]))
  for (const entry of entries) {
    if (!byPath.has(entry.path)) byPath.set(entry.path, entry)
  }
  const merged = [...byPath.values()]
  persist(merged)
  return listLocalMedia()
}

// 移除引用；deleteFile=true 时把磁盘文件一并移入系统回收站（误删可恢复）。
// 回收站失败（如网络盘）时抛错并保留引用，让 UI 报错而不是悄悄丢文件
export async function removeLocalMedia(path: string, deleteFile = false): Promise<LocalMediaEntry[]> {
  if (deleteFile && existsSync(path)) await shell.trashItem(path)
  persist(loadAll().filter((entry) => entry.path !== path))
  return listLocalMedia()
}
