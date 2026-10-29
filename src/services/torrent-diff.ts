// 任务状态的「是否真的变了」判定：主进程每秒推送一次全量 TorrentStatus（含 files 数组，
// 一个大种子可有几百项）。用 JSON.stringify 做比较会每秒把整个对象树序列化一遍，
// 任务越多、文件越多越慢，还产生大量临时字符串。
// 这里只逐字段比较——同样是 O(n)，但零分配，且能精确指出变化发生在哪个维度。

import type { TorrentFileInfo, TorrentStatus } from '../types'

function sameFiles(a: TorrentFileInfo[], b: TorrentFileInfo[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    // 文件行只关心进度与路径；size/name/type 在任务生命周期内不变
    if (x.path !== y.path || x.completed !== y.completed || x.size !== y.size) return false
  }
  return true
}

// 两个任务状态在「界面可见」的维度上是否等价
export function sameTorrentStatus(a: TorrentStatus | undefined, b: TorrentStatus | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.infoHash === b.infoHash
    && a.status === b.status
    && a.progress === b.progress
    && a.downloadSpeed === b.downloadSpeed
    && a.uploadSpeed === b.uploadSpeed
    && a.downloaded === b.downloaded
    && a.totalSize === b.totalSize
    && a.numPeers === b.numPeers
    && a.timeRemaining === b.timeRemaining
    && a.uploaded === b.uploaded
    && a.error === b.error
    && a.queuePosition === b.queuePosition
    && a.name === b.name
    && a.saveDir === b.saveDir
    && a.magnetURI === b.magnetURI
    && a.type === b.type
    && a.sourceUrl === b.sourceUrl
    && a.addedAt === b.addedAt
    && sameFiles(a.files || [], b.files || [])
}

// 两个任务列表是否等价（顺序敏感：调用方已排序）
export function sameTorrentList(a: TorrentStatus[], b: TorrentStatus[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!sameTorrentStatus(a[i], b[i])) return false
  return true
}

// 合并单条状态推送：返回原数组表示没有可见变化，避免无谓的重渲染
export function mergeStatusUpdate(current: TorrentStatus[], status: TorrentStatus, sort: (list: TorrentStatus[]) => TorrentStatus[]): TorrentStatus[] {
  const index = current.findIndex((item) => item.infoHash === status.infoHash)
  if (index < 0) return sort([...current, status])
  // 单条替换后仍落在同一位置时无需重排，省一次排序与数组分配
  const next = current.slice()
  next[index] = status
  const sorted = sort(next)
  return sameTorrentList(current, sorted) ? current : sorted
}

// 文件行 memo 的比较器用：只比较影响渲染的字段
export function sameTorrentFile(a: TorrentFileInfo, b: TorrentFileInfo): boolean {
  return a === b || (a.path === b.path && a.completed === b.completed && a.size === b.size && a.name === b.name && a.selected === b.selected)
}
