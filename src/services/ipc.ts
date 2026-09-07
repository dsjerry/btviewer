import type { AppSettings, IPCResult, TorrentStatus, UpdaterEvent, WatchProgress } from '../types'

export interface ElectronAPI {
  minimizeWindow: () => Promise<{ success: boolean }>
  toggleMaximizeWindow: () => Promise<{ success: boolean; maximized?: boolean }>
  closeWindow: () => Promise<{ success: boolean }>
  addTorrent: (torrentId: string) => Promise<IPCResult<TorrentStatus>>
  removeTorrent: (infoHash: string, destroy?: boolean) => Promise<IPCResult>
  pauseTorrent: (infoHash: string) => Promise<IPCResult>
  resumeTorrent: (infoHash: string) => Promise<IPCResult>
  downloadTorrent: (infoHash: string, filePaths?: string[]) => Promise<IPCResult>
  getAllStatuses: () => Promise<TorrentStatus[]>
  getStreamUrl: (infoHash: string, filePath: string) => Promise<string>
  getSubtitleUrl: (infoHash: string, filePath: string) => Promise<string>
  getProgress: (infoHash: string, filePath: string) => Promise<WatchProgress | null>
  setProgress: (infoHash: string, filePath: string, position: number, duration: number) => Promise<void>
  checkForUpdates: () => Promise<IPCResult>
  installUpdate: () => Promise<IPCResult>
  getPathForFile: (file: File) => string
  openFile: () => Promise<IPCResult<TorrentStatus>>
  pickDownloadDir: () => Promise<IPCResult<string>>
  getSettings: () => Promise<IPCResult<AppSettings>>
  saveSettings: (patch: Partial<AppSettings>) => Promise<IPCResult<AppSettings>>
  openPath: (path: string) => Promise<IPCResult>
  openExternal: (url: string) => Promise<IPCResult>
  onStatusUpdate: (callback: (status: TorrentStatus) => void) => () => void
  onUpdaterEvent: (callback: (event: UpdaterEvent) => void) => () => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

function getElectronAPI(): ElectronAPI {
  if (!window.electronAPI) {
    throw new Error('BTViewer 运行环境未正确初始化，请重启应用')
  }
  return window.electronAPI
}

export const ipc: ElectronAPI = {
  minimizeWindow: () => getElectronAPI().minimizeWindow(),
  toggleMaximizeWindow: () => getElectronAPI().toggleMaximizeWindow(),
  closeWindow: () => getElectronAPI().closeWindow(),
  addTorrent: (torrentId) => getElectronAPI().addTorrent(torrentId),
  removeTorrent: (infoHash, destroy) => getElectronAPI().removeTorrent(infoHash, destroy),
  pauseTorrent: (infoHash) => getElectronAPI().pauseTorrent(infoHash),
  resumeTorrent: (infoHash) => getElectronAPI().resumeTorrent(infoHash),
  downloadTorrent: (infoHash, filePaths) => getElectronAPI().downloadTorrent(infoHash, filePaths),
  getAllStatuses: () => getElectronAPI().getAllStatuses(),
  getStreamUrl: (infoHash, filePath) => getElectronAPI().getStreamUrl(infoHash, filePath),
  getSubtitleUrl: (infoHash, filePath) => getElectronAPI().getSubtitleUrl(infoHash, filePath),
  getProgress: (infoHash, filePath) => getElectronAPI().getProgress(infoHash, filePath),
  setProgress: (infoHash, filePath, position, duration) => getElectronAPI().setProgress(infoHash, filePath, position, duration),
  checkForUpdates: () => getElectronAPI().checkForUpdates(),
  installUpdate: () => getElectronAPI().installUpdate(),
  getPathForFile: (file) => getElectronAPI().getPathForFile(file),
  openFile: () => getElectronAPI().openFile(),
  pickDownloadDir: () => getElectronAPI().pickDownloadDir(),
  getSettings: () => getElectronAPI().getSettings(),
  saveSettings: (patch) => getElectronAPI().saveSettings(patch),
  openPath: (path) => getElectronAPI().openPath(path),
  openExternal: (url) => getElectronAPI().openExternal(url),
  onStatusUpdate: (callback) => getElectronAPI().onStatusUpdate(callback),
  onUpdaterEvent: (callback) => getElectronAPI().onUpdaterEvent(callback)
}
