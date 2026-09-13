import type { AppSettings, Feed, IPCResult, TorrentStatus, UpdaterEvent, WatchProgress } from '../types'

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
  getThumbnails: (keys: string[]) => Promise<IPCResult<Array<string | null>>>
  saveThumbnail: (key: string, dataUrl: string) => Promise<IPCResult>
  feedsGet: () => Promise<IPCResult<Feed[]>>
  feedsAdd: (input: { name?: string; url?: string; keywords?: string[]; autoDownload?: boolean; groupBySeason?: boolean }) => Promise<IPCResult<Feed>>
  feedsUpdate: (id: string, patch: Partial<Pick<Feed, 'name' | 'url' | 'keywords' | 'autoDownload' | 'groupBySeason' | 'enabled'>>) => Promise<IPCResult<Feed>>
  feedsRemove: (id: string) => Promise<IPCResult>
  feedsCheck: (id: string) => Promise<IPCResult<Feed[]>>
  feedsDownloadItem: (feedId: string, guid: string) => Promise<IPCResult>
  saveMediaFile: (defaultName: string, dataUrl: string) => Promise<IPCResult<string>>
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
  getThumbnails: (keys) => getElectronAPI().getThumbnails(keys),
  saveThumbnail: (key, dataUrl) => getElectronAPI().saveThumbnail(key, dataUrl),
  feedsGet: () => getElectronAPI().feedsGet(),
  feedsAdd: (input) => getElectronAPI().feedsAdd(input),
  feedsUpdate: (id, patch) => getElectronAPI().feedsUpdate(id, patch),
  feedsRemove: (id) => getElectronAPI().feedsRemove(id),
  feedsCheck: (id) => getElectronAPI().feedsCheck(id),
  feedsDownloadItem: (feedId, guid) => getElectronAPI().feedsDownloadItem(feedId, guid),
  saveMediaFile: (defaultName, dataUrl) => getElectronAPI().saveMediaFile(defaultName, dataUrl),
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
