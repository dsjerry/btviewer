export interface TorrentFileInfo {
  name: string
  path: string
  size: number
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
  logDir?: string
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
