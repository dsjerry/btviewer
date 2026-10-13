import type { TorrentStatus, WatchProgress } from '../types'

// 任务协议徽标文案；旧持久化数据缺省视为 BT（与 CSS .task-type 配合使用）
export const TYPE_LABELS = { bt: 'BT', http: 'HTTP', ftp: 'FTP', metalink: 'Metalink', video: '视频' } as const
// 任务状态文案：键名与 CSS .status-pill/.download-status 的修饰类一一对应
export const STATUS_LABELS = { parsing: '解析中', connecting: '连接中', downloading: '下载中', seeding: '已完成', paused: '已暂停', error: '错误' }

export function taskType(torrent: TorrentStatus) { return torrent.type || 'bt' }

// 人类可读体积；0 或无效值显示 0 B
export function formatSize(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

// 观看进度：媒体库展示「看到哪」，与下载状态无关。duration 未知时退化为「观看中」
export function watchPercent(watch: WatchProgress | null | undefined): number {
  if (!watch || !watch.duration || !Number.isFinite(watch.duration)) return 0
  return Math.min(100, Math.max(0, Math.round((watch.position / watch.duration) * 100)))
}

export function watchLabel(watch: WatchProgress | null | undefined): string {
  if (!watch || !watch.position) return '未观看'
  const percent = watchPercent(watch)
  if (!percent) return '观看中'
  return percent >= 95 ? '已看完' : `已看 ${percent}%`
}
