export interface TorrentFileInfo {
  name: string
  path: string
  size: number
  // 已下载字节数（任务进行中会随状态刷新增长），用于单文件进度展示
  completed: number
  type: 'video' | 'audio' | 'subtitle' | 'other'
}

export type TorrentStatusType = 'parsing' | 'connecting' | 'downloading' | 'seeding' | 'paused' | 'error'

export interface TorrentStatus {
  infoHash: string
  name: string
  magnetURI: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  downloaded: number
  totalSize: number
  numPeers: number
  timeRemaining: number
  status: TorrentStatusType
  files: TorrentFileInfo[]
  error?: string
}

export interface AppSettings {
  downloadDir?: string
  trackers?: string
  maxConcurrentDownloads?: number
  speedLimit?: string
  logDir?: string
}

// 单个媒体文件的观看进度，用于续播
export interface WatchProgress {
  position: number
  duration: number
  updatedAt: number
}

// 自动更新事件（electron-updater 事件转发到渲染层）
export interface UpdaterEvent {
  type: 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'
  version?: string
  percent?: number
  message?: string
}

export interface IPCResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
  canceled?: boolean
}

export type IPCChannel =
  | 'torrent:add'
  | 'torrent:remove'
  | 'torrent:pause'
  | 'torrent:resume'
  | 'torrent:all-status'
  | 'torrent:get-stream-url'
  | 'dialog:open-file'
