// aria2 状态/数值到应用模型的纯映射（D2）：抽出来便于单测覆盖分支，
// 这些规则直接决定界面显示什么（是否已完成、是否在下载、进度与剩余时间）。
import type { TorrentStatus } from '../src/types'

export interface AriaStateInput {
  // aria2 tellStatus 的 status 字段
  status: string
  // aria2 的 seeder 字段（做种中的任务 status 仍是 active）
  seeder?: string
  // 是否是 metadata 下载中的父任务（文件列表还没拿到）
  isMetadata: boolean
}

// 优先级：错误 > 解析中 > 暂停 > 做种/完成 > 下载中 > 连接中
export function mapAriaState({ status, seeder, isMetadata }: AriaStateInput): TorrentStatus['status'] {
  if (status === 'error') return 'error'
  if (isMetadata) return 'parsing'
  if (status === 'paused') return 'paused'
  if (status === 'complete' || seeder === 'true') return 'seeding'
  if (status === 'active') return 'downloading'
  return 'connecting'
}

// 是否已下满：做种中同样算完成；总长度未知（磁力解析中）时不算
export function isFinished(downloaded: number, total: number): boolean {
  return total > 0 && downloaded >= total
}

export function computeProgress(downloaded: number, total: number): number {
  if (!total || total <= 0) return 0
  return Math.min(1, Math.max(0, downloaded / total))
}

// 剩余毫秒；速度为 0（未开始/已暂停）时返回 0，界面据此显示「计算中」
export function computeTimeRemaining(downloaded: number, total: number, speed: number): number {
  if (!speed || speed <= 0) return 0
  const remaining = total - downloaded
  if (remaining <= 0) return 0
  return Math.ceil((remaining / speed) * 1000)
}

// 失败自动重试的退避：5s 起指数增长，封顶 2 分钟；超过上限返回 null（不再重试）
export function retryDelayMs(attempt: number, maxRetries: number): number | null {
  if (!Number.isFinite(attempt) || attempt < 1) return null
  if (attempt > maxRetries) return null
  return Math.min(120000, 5000 * 2 ** (attempt - 1))
}

export interface SelectableFile {
  index: string
  path: string
}

// 「只下载选中文件」：按完整路径或文件名匹配 aria2 的文件序号；
// 没传 filePaths 表示全选，传了但一个都没匹配上返回空数组（调用方据此报错，避免误下全量）
export function selectFileIndexes(files: SelectableFile[], filePaths?: string[], baseName: (path: string) => string = (path) => path.split(/[\\/]/).pop() || path): string[] {
  if (!filePaths?.length) return files.map((file) => file.index)
  return files
    .filter((file) => filePaths.includes(file.path) || filePaths.includes(baseName(file.path)))
    .map((file) => file.index)
}
