import { contextBridge, ipcRenderer, webUtils } from 'electron'
// 类型单一来源：接口定义在 src/services/ipc.ts，这里注解后方法签名不匹配会在编译期暴露
import type { ElectronAPI } from '../src/services/ipc'
import type { CompatProgressEvent, GlobalStat, TorrentStatus } from '../src/types'

const electronAPI: ElectronAPI = {
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  addTask: (input: string) => ipcRenderer.invoke('torrent:add', input),
  checkYtDlp: (customPath?: string) => ipcRenderer.invoke('ytdlp:check', customPath),
  installerCapabilities: () => ipcRenderer.invoke('installer:capabilities'),
  installYtDlp: () => ipcRenderer.invoke('ytdlp:install'),
  updateYtDlp: (binaryPath: string) => ipcRenderer.invoke('ytdlp:update', binaryPath),
  installFfmpeg: () => ipcRenderer.invoke('ffmpeg:install'),
  installDeno: () => ipcRenderer.invoke('deno:install'),
  onYtdlpInstallProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as { received: number; total: number })
    ipcRenderer.on('ytdlp:install-progress', listener)
    return () => ipcRenderer.removeListener('ytdlp:install-progress', listener)
  },
  onFfmpegInstallProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as { received: number; total: number })
    ipcRenderer.on('ffmpeg:install-progress', listener)
    return () => ipcRenderer.removeListener('ffmpeg:install-progress', listener)
  },
  onDenoInstallProgress: (callback: (progress: { received: number; total: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as { received: number; total: number })
    ipcRenderer.on('deno:install-progress', listener)
    return () => ipcRenderer.removeListener('deno:install-progress', listener)
  },
  removeTorrent: (infoHash: string, destroy = false) => ipcRenderer.invoke('torrent:remove', infoHash, destroy),
  pauseTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:pause', infoHash),
  resumeTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:resume', infoHash),
  retryTorrent: (infoHash: string) => ipcRenderer.invoke('torrent:retry', infoHash),
  setTaskSpeedLimit: (infoHash: string, limit: string) => ipcRenderer.invoke('torrent:set-speed-limit', infoHash, limit),
  moveTask: (infoHash: string, action: 'top' | 'up' | 'down') => ipcRenderer.invoke('torrent:move', infoHash, action),
  pauseAll: () => ipcRenderer.invoke('torrent:pause-all'),
  resumeAll: () => ipcRenderer.invoke('torrent:resume-all'),
  prioritizeStream: (infoHash: string, offsetBytes?: number) => ipcRenderer.invoke('torrent:prioritize-stream', infoHash, offsetBytes),
  taskPeers: (infoHash: string) => ipcRenderer.invoke('torrent:peers', infoHash),
  taskTrackers: (infoHash: string) => ipcRenderer.invoke('torrent:trackers', infoHash),
  networkStatus: () => ipcRenderer.invoke('engine:network-status'),
  restartEngine: () => ipcRenderer.invoke('engine:restart'),
  addTasksBatch: (inputs: string[]) => ipcRenderer.invoke('torrent:add-batch', inputs),
  compatPlan: (infoHash: string, filePath: string, audioIndex?: number) => ipcRenderer.invoke('media:compat-plan', infoHash, filePath, audioIndex),
  compatStart: (infoHash: string, filePath: string, audioIndex?: number) => ipcRenderer.invoke('media:compat-start', infoHash, filePath, audioIndex),
  compatUrl: (id: string) => ipcRenderer.invoke('media:compat-url', id),
  compatCancel: (id: string) => ipcRenderer.invoke('media:compat-cancel', id),
  onCompatProgress: (callback: (event: CompatProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload as CompatProgressEvent)
    ipcRenderer.on('media:compat-progress', listener)
    return () => ipcRenderer.removeListener('media:compat-progress', listener)
  },
  exportTasks: () => ipcRenderer.invoke('tasks:export'),
  importTasks: () => ipcRenderer.invoke('tasks:import'),
  downloadTorrent: (infoHash: string, filePaths?: string[]) => ipcRenderer.invoke('torrent:download', infoHash, filePaths),
  getAllStatuses: () => ipcRenderer.invoke('torrent:all-status'),
  getGlobalStat: () => ipcRenderer.invoke('torrent:global-stat'),
  getStreamUrl: (infoHash: string, filePath: string) => ipcRenderer.invoke('torrent:get-stream-url', infoHash, filePath),
  getSubtitleUrl: (infoHash: string, filePath: string) => ipcRenderer.invoke('torrent:get-subtitle-url', infoHash, filePath),
  getProgress: (infoHash: string, filePath: string) => ipcRenderer.invoke('progress:get', infoHash, filePath),
  setProgress: (infoHash: string, filePath: string, position: number, duration: number) => ipcRenderer.invoke('progress:set', infoHash, filePath, position, duration),
  getThumbnails: (keys: string[]) => ipcRenderer.invoke('thumbs:get', keys),
  saveThumbnail: (key: string, dataUrl: string) => ipcRenderer.invoke('thumbs:set', key, dataUrl),
  getEmbeddedCover: (infoHash: string, filePath: string) => ipcRenderer.invoke('thumbs:cover', infoHash, filePath),
  feedsGet: () => ipcRenderer.invoke('feeds:get'),
  feedsAdd: (input: { name?: string; url?: string; keywords?: string[]; autoDownload?: boolean; groupBySeason?: boolean }) => ipcRenderer.invoke('feeds:add', input),
  feedsUpdate: (id: string, patch: Record<string, unknown>) => ipcRenderer.invoke('feeds:update', id, patch),
  feedsRemove: (id: string) => ipcRenderer.invoke('feeds:remove', id),
  feedsCheck: (id: string) => ipcRenderer.invoke('feeds:check', id),
  feedsDownloadItem: (feedId: string, guid: string) => ipcRenderer.invoke('feeds:download-item', feedId, guid),
  saveMediaFile: (defaultName: string, dataUrl: string) => ipcRenderer.invoke('media:save', defaultName, dataUrl),
  recordBegin: (defaultName: string) => ipcRenderer.invoke('media:record-begin', defaultName),
  recordAppend: (id: string, chunk: Uint8Array) => ipcRenderer.invoke('media:record-append', id, chunk),
  recordEnd: (id: string) => ipcRenderer.invoke('media:record-end', id),
  recordAbort: (id: string) => ipcRenderer.invoke('media:record-abort', id),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  openFile: () => ipcRenderer.invoke('dialog:open-file'),
  pickDownloadDir: () => ipcRenderer.invoke('dialog:pick-download-dir'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: Record<string, unknown>) => ipcRenderer.invoke('settings:set', patch),
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path),
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
  onStatusUpdate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status as TorrentStatus)
    ipcRenderer.on('torrent:status-update', listener)
    return () => ipcRenderer.removeListener('torrent:status-update', listener)
  },
  // 外部输入（双击种子 / 点磁力链接 / 二次启动命令行）
  onOpenInput: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, input: unknown) => callback(String(input ?? ''))
    ipcRenderer.on('app:open-input', listener)
    return () => ipcRenderer.removeListener('app:open-input', listener)
  },
  // 全局统计推送（侧边栏速度）
  onGlobalStat: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, stat: unknown) => callback(stat as GlobalStat)
    ipcRenderer.on('torrent:global-stat-update', listener)
    return () => ipcRenderer.removeListener('torrent:global-stat-update', listener)
  },
  // 点系统通知跳转到对应任务
  onFocusTask: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, hash: unknown) => callback(String(hash ?? ''))
    ipcRenderer.on('app:focus-task', listener)
    return () => ipcRenderer.removeListener('app:focus-task', listener)
  },
  // 剪贴板检测到链接（仅提示，不自动下载）
  onClipboardInput: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, input: unknown) => callback(String(input ?? ''))
    ipcRenderer.on('app:clipboard-input', listener)
    return () => ipcRenderer.removeListener('app:clipboard-input', listener)
  },
  // 原生菜单（macOS 菜单栏）跳转视图
  onNavigate: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, view: unknown) => callback(String(view ?? ''))
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  ignoreClipboardInput: (input: string) => ipcRenderer.invoke('clipboard:ignore', input),
  listLogs: () => ipcRenderer.invoke('logs:list'),
  readLogs: (maxLines?: number, fileName?: string) => ipcRenderer.invoke('logs:read', maxLines, fileName),
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get'),
  checkLatestRelease: () => ipcRenderer.invoke('update:check')
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
