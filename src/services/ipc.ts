import type { IPCResult, TorrentStatus } from '../types'

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
  openFile: () => Promise<IPCResult<TorrentStatus>>
  onStatusUpdate: (callback: (status: TorrentStatus) => void) => () => void
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
  openFile: () => getElectronAPI().openFile(),
  onStatusUpdate: (callback) => getElectronAPI().onStatusUpdate(callback)
}
