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
  downloadTorrent: (infoHash: string, filePaths?: string[]) => ipcRenderer.invoke('torrent:download', infoHash, filePaths),
  getAllStatuses: () => ipcRenderer.invoke('torrent:all-status'),
  getStreamUrl: (infoHash: string, filePath: string) => ipcRenderer.invoke('torrent:get-stream-url', infoHash, filePath),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  pickDownloadDir: () => ipcRenderer.invoke('dialog:pick-download-dir'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path'),
  onStatusUpdate: (callback: StatusListener) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status)
    ipcRenderer.on('torrent:status-update', listener)
    return () => ipcRenderer.removeListener('torrent:status-update', listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
