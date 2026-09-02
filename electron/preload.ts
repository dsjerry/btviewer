import { contextBridge, ipcRenderer } from 'electron'

type StatusListener = (status: unknown) => void

const electronAPI = {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  addTorrent: (torrentId: string) => ipcRenderer.invoke('torrent:add', torrentId),
  removeTorrent: (infoHash: string, destroy = false) => ipcRenderer.invoke('torrent:remove', infoHash, destroy),
  pauseTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:pause', infoHash),
  resumeTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:resume', infoHash),
  downloadTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:download', infoHash),
  getAllStatuses: () => ipcRenderer.invoke('torrent:all-status'),
  getStreamUrl: (infoHash: string, filePath: string) => ipcRenderer.invoke('torrent:get-stream-url', infoHash, filePath),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  onStatusUpdate: (callback: StatusListener) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on('torrent:status-update', listener)
    return () => ipcRenderer.removeListener('torrent:status-update', listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
