import { t } from './i18n'
import type { LocalMediaEntry, TorrentFileInfo, TorrentStatus, WatchProgress } from '../types'

// 任务协议徽标文案；旧持久化数据缺省视为 BT（与 CSS .task-type 配合使用）
// 常量保留给非组件场景（如日志/导出），界面统一走 typeLabel/statusLabel 以支持语言切换
export const TYPE_LABELS = { bt: 'BT', http: 'HTTP', ftp: 'FTP', metalink: 'Metalink', video: '视频' } as const
// 任务状态文案：键名与 CSS .status-pill/.download-status 的修饰类一一对应
export const STATUS_LABELS = { parsing: '解析中', connecting: '连接中', downloading: '下载中', seeding: '已完成', paused: '已暂停', error: '错误' }

export function typeLabel(type: keyof typeof TYPE_LABELS) { return t(`type.${type}`) }
export function statusLabel(status: TorrentStatus['status']) { return t(`status.${status}`) }

export function taskType(torrent: TorrentStatus) { return torrent.type || 'bt' }

// 本地媒体文件的扩展名（PotPlayer 式拖放入播放器用）；与主进程 local:pick 的过滤器保持一致
export const LOCAL_MEDIA_FILE_RE = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|flv|ts|rmvb|mp3|flac|wav|aac|ogg|m4a|wma)$/i

// 媒体库本地引用 → 播放器文件描述：completed=size 让「边下边播」优先级逻辑自然跳过本地文件
export function localEntryToFile(entry: LocalMediaEntry): TorrentFileInfo {
  return { name: entry.name, path: entry.path, size: entry.size, completed: entry.size, type: entry.type, localPath: entry.path }
}

// 人类可读体积；0 或无效值显示 0 B
export function formatSize(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4)
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

// 速度展示（B/s）；0 或无效值显示 0 B/s。主进程的托盘提示与渲染层侧边栏共用
export function formatSpeed(value: number) {
  if (!value || !Number.isFinite(value) || value < 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
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
