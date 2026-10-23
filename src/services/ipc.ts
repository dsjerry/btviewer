import type { AppSettings, BatchAddSummary, CompatPlanResult, CompatProgressEvent, CompatStartResult, EngineNetworkStatus, Feed, GlobalStat, IPCResult, TaskImportSummary, TaskPeer, TorrentStatus, WatchProgress } from '../types'

// capabilities：该平台能否一键安装，决定设置页显示「安装」按钮还是面向普通用户的说明
export interface InstallCapabilities { ytdlp: boolean; ffmpeg: boolean; deno: boolean }
export interface YtdlpCheck { available: boolean; path: string; ffmpegAvailable: boolean; jsRuntime: { name: string; path: string; version?: string } | null; capabilities?: InstallCapabilities }

// 运行日志（C5）：主进程解析好的日志行与文件清单
export interface LogEntry { time: string; level: string; tag: string; message: string; raw: string }
export interface LogFileInfo { name: string; size: number; modifiedAt: number }

export interface ElectronAPI {
  minimizeWindow: () => Promise<{ success: boolean }>
  toggleMaximizeWindow: () => Promise<{ success: boolean; maximized?: boolean }>
  closeWindow: () => Promise<{ success: boolean }>
  addTask: (input: string) => Promise<IPCResult<TorrentStatus>>
  checkYtDlp: (customPath?: string) => Promise<IPCResult<YtdlpCheck>>
  installerCapabilities: () => Promise<IPCResult<InstallCapabilities>>
  installYtDlp: () => Promise<IPCResult<string>>
  updateYtDlp: (binaryPath: string) => Promise<IPCResult<string>>
  installFfmpeg: () => Promise<IPCResult<string>>
  installDeno: () => Promise<IPCResult<string>>
  onYtdlpInstallProgress: (callback: (progress: { received: number; total: number }) => void) => () => void
  onFfmpegInstallProgress: (callback: (progress: { received: number; total: number }) => void) => () => void
  onDenoInstallProgress: (callback: (progress: { received: number; total: number }) => void) => () => void
  removeTorrent: (infoHash: string, destroy?: boolean) => Promise<IPCResult>
  pauseTorrent: (infoHash: string) => Promise<IPCResult>
  resumeTorrent: (infoHash: string) => Promise<IPCResult>
  retryTorrent: (infoHash: string) => Promise<IPCResult<TorrentStatus>>
  setTaskSpeedLimit: (infoHash: string, limit: string) => Promise<IPCResult>
  moveTask: (infoHash: string, action: 'top' | 'up' | 'down') => Promise<IPCResult>
  pauseAll: () => Promise<IPCResult<string[]>>
  resumeAll: () => Promise<IPCResult<string[]>>
  prioritizeStream: (infoHash: string, offsetBytes?: number) => Promise<IPCResult<{ applied: boolean; option: string }>>
  taskPeers: (infoHash: string) => Promise<IPCResult<TaskPeer[]>>
  taskTrackers: (infoHash: string) => Promise<IPCResult<string[]>>
  networkStatus: () => Promise<IPCResult<EngineNetworkStatus>>
  restartEngine: () => Promise<IPCResult>
  addTasksBatch: (inputs: string[]) => Promise<IPCResult<BatchAddSummary>>
  compatPlan: (infoHash: string, filePath: string, audioIndex?: number) => Promise<IPCResult<CompatPlanResult>>
  compatStart: (infoHash: string, filePath: string, audioIndex?: number) => Promise<IPCResult<CompatStartResult>>
  compatUrl: (id: string) => Promise<IPCResult<string>>
  compatCancel: (id: string) => Promise<IPCResult>
  onCompatProgress: (callback: (event: CompatProgressEvent) => void) => () => void
  exportTasks: () => Promise<IPCResult<{ path: string; count: number }>>
  importTasks: () => Promise<IPCResult<TaskImportSummary>>
  downloadTorrent: (infoHash: string, filePaths?: string[]) => Promise<IPCResult>
  getAllStatuses: () => Promise<TorrentStatus[]>
  getGlobalStat: () => Promise<IPCResult<GlobalStat>>
  getStreamUrl: (infoHash: string, filePath: string) => Promise<string>
  getSubtitleUrl: (infoHash: string, filePath: string) => Promise<string>
  getProgress: (infoHash: string, filePath: string) => Promise<WatchProgress | null>
  setProgress: (infoHash: string, filePath: string, position: number, duration: number) => Promise<void>
  getThumbnails: (keys: string[]) => Promise<IPCResult<Array<string | null>>>
  saveThumbnail: (key: string, dataUrl: string) => Promise<IPCResult>
  getEmbeddedCover: (infoHash: string, filePath: string) => Promise<IPCResult<string | null>>
  feedsGet: () => Promise<IPCResult<Feed[]>>
  feedsAdd: (input: { name?: string; url?: string; keywords?: string[]; autoDownload?: boolean; groupBySeason?: boolean }) => Promise<IPCResult<Feed>>
  feedsUpdate: (id: string, patch: Partial<Pick<Feed, 'name' | 'url' | 'keywords' | 'autoDownload' | 'groupBySeason' | 'enabled'>>) => Promise<IPCResult<Feed>>
  feedsRemove: (id: string) => Promise<IPCResult>
  feedsCheck: (id: string) => Promise<IPCResult<Feed[]>>
  feedsDownloadItem: (feedId: string, guid: string) => Promise<IPCResult>
  saveMediaFile: (defaultName: string, dataUrl: string) => Promise<IPCResult<string>>
  recordBegin: (defaultName: string) => Promise<IPCResult<{ id: string; path: string }>>
  recordAppend: (id: string, chunk: Uint8Array) => Promise<IPCResult>
  recordEnd: (id: string) => Promise<IPCResult<string>>
  recordAbort: (id: string) => Promise<IPCResult>
  getPathForFile: (file: File) => string
  openFile: () => Promise<IPCResult<TorrentStatus>>
  pickDownloadDir: () => Promise<IPCResult<string>>
  getSettings: () => Promise<IPCResult<AppSettings>>
  saveSettings: (patch: Partial<AppSettings>) => Promise<IPCResult<AppSettings>>
  openPath: (path: string) => Promise<IPCResult>
  openExternal: (url: string) => Promise<IPCResult>
  onStatusUpdate: (callback: (status: TorrentStatus) => void) => () => void
  onOpenInput: (callback: (input: string) => void) => () => void
  onGlobalStat: (callback: (stat: GlobalStat) => void) => () => void
  onFocusTask: (callback: (infoHash: string) => void) => () => void
  onClipboardInput: (callback: (input: string) => void) => () => void
  // 原生菜单跳转（macOS 菜单栏「设置…」等），参数是视图名，未知视图由渲染层忽略
  onNavigate: (callback: (view: string) => void) => () => void
  ignoreClipboardInput: (input: string) => Promise<IPCResult>
  listLogs: () => Promise<IPCResult<LogFileInfo[]>>
  readLogs: (maxLines?: number, fileName?: string) => Promise<IPCResult<{ name: string; entries: LogEntry[] }>>
  getDiagnostics: () => Promise<IPCResult<string>>
  checkLatestRelease: () => Promise<IPCResult<UpdateCheckResult>>
}

// 轻量更新检查结果（C7）
export interface UpdateCheckResult {
  current: string
  version: string
  url: string
  publishedAt: string
  notes: string
  hasUpdate: boolean
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
  addTask: (input) => getElectronAPI().addTask(input),
  checkYtDlp: (customPath) => getElectronAPI().checkYtDlp(customPath),
  installerCapabilities: () => getElectronAPI().installerCapabilities(),
  installYtDlp: () => getElectronAPI().installYtDlp(),
  updateYtDlp: (binaryPath) => getElectronAPI().updateYtDlp(binaryPath),
  installFfmpeg: () => getElectronAPI().installFfmpeg(),
  installDeno: () => getElectronAPI().installDeno(),
  onYtdlpInstallProgress: (callback) => getElectronAPI().onYtdlpInstallProgress(callback),
  onFfmpegInstallProgress: (callback) => getElectronAPI().onFfmpegInstallProgress(callback),
  onDenoInstallProgress: (callback) => getElectronAPI().onDenoInstallProgress(callback),
  removeTorrent: (infoHash, destroy) => getElectronAPI().removeTorrent(infoHash, destroy),
  pauseTorrent: (infoHash) => getElectronAPI().pauseTorrent(infoHash),
  resumeTorrent: (infoHash) => getElectronAPI().resumeTorrent(infoHash),
  retryTorrent: (infoHash) => getElectronAPI().retryTorrent(infoHash),
  setTaskSpeedLimit: (infoHash, limit) => getElectronAPI().setTaskSpeedLimit(infoHash, limit),
  moveTask: (infoHash, action) => getElectronAPI().moveTask(infoHash, action),
  pauseAll: () => getElectronAPI().pauseAll(),
  resumeAll: () => getElectronAPI().resumeAll(),
  prioritizeStream: (infoHash, offsetBytes) => getElectronAPI().prioritizeStream(infoHash, offsetBytes),
  taskPeers: (infoHash) => getElectronAPI().taskPeers(infoHash),
  taskTrackers: (infoHash) => getElectronAPI().taskTrackers(infoHash),
  networkStatus: () => getElectronAPI().networkStatus(),
  restartEngine: () => getElectronAPI().restartEngine(),
  addTasksBatch: (inputs) => getElectronAPI().addTasksBatch(inputs),
  compatPlan: (infoHash, filePath, audioIndex) => getElectronAPI().compatPlan(infoHash, filePath, audioIndex),
  compatStart: (infoHash, filePath, audioIndex) => getElectronAPI().compatStart(infoHash, filePath, audioIndex),
  compatUrl: (id) => getElectronAPI().compatUrl(id),
  compatCancel: (id) => getElectronAPI().compatCancel(id),
  onCompatProgress: (callback) => getElectronAPI().onCompatProgress(callback),
  exportTasks: () => getElectronAPI().exportTasks(),
  importTasks: () => getElectronAPI().importTasks(),
  downloadTorrent: (infoHash, filePaths) => getElectronAPI().downloadTorrent(infoHash, filePaths),
  getAllStatuses: () => getElectronAPI().getAllStatuses(),
  getGlobalStat: () => getElectronAPI().getGlobalStat(),
  getStreamUrl: (infoHash, filePath) => getElectronAPI().getStreamUrl(infoHash, filePath),
  getSubtitleUrl: (infoHash, filePath) => getElectronAPI().getSubtitleUrl(infoHash, filePath),
  getProgress: (infoHash, filePath) => getElectronAPI().getProgress(infoHash, filePath),
  setProgress: (infoHash, filePath, position, duration) => getElectronAPI().setProgress(infoHash, filePath, position, duration),
  getThumbnails: (keys) => getElectronAPI().getThumbnails(keys),
  saveThumbnail: (key, dataUrl) => getElectronAPI().saveThumbnail(key, dataUrl),
  getEmbeddedCover: (infoHash, filePath) => getElectronAPI().getEmbeddedCover(infoHash, filePath),
  feedsGet: () => getElectronAPI().feedsGet(),
  feedsAdd: (input) => getElectronAPI().feedsAdd(input),
  feedsUpdate: (id, patch) => getElectronAPI().feedsUpdate(id, patch),
  feedsRemove: (id) => getElectronAPI().feedsRemove(id),
  feedsCheck: (id) => getElectronAPI().feedsCheck(id),
  feedsDownloadItem: (feedId, guid) => getElectronAPI().feedsDownloadItem(feedId, guid),
  saveMediaFile: (defaultName, dataUrl) => getElectronAPI().saveMediaFile(defaultName, dataUrl),
  recordBegin: (defaultName) => getElectronAPI().recordBegin(defaultName),
  recordAppend: (id, chunk) => getElectronAPI().recordAppend(id, chunk),
  recordEnd: (id) => getElectronAPI().recordEnd(id),
  recordAbort: (id) => getElectronAPI().recordAbort(id),
  getPathForFile: (file) => getElectronAPI().getPathForFile(file),
  openFile: () => getElectronAPI().openFile(),
  pickDownloadDir: () => getElectronAPI().pickDownloadDir(),
  getSettings: () => getElectronAPI().getSettings(),
  saveSettings: (patch) => getElectronAPI().saveSettings(patch),
  openPath: (path) => getElectronAPI().openPath(path),
  openExternal: (url) => getElectronAPI().openExternal(url),
  onStatusUpdate: (callback) => getElectronAPI().onStatusUpdate(callback),
  onOpenInput: (callback) => getElectronAPI().onOpenInput(callback),
  onGlobalStat: (callback) => getElectronAPI().onGlobalStat(callback),
  onFocusTask: (callback) => getElectronAPI().onFocusTask(callback),
  onClipboardInput: (callback) => getElectronAPI().onClipboardInput(callback),
  onNavigate: (callback) => getElectronAPI().onNavigate(callback),
  ignoreClipboardInput: (input) => getElectronAPI().ignoreClipboardInput(input),
  listLogs: () => getElectronAPI().listLogs(),
  readLogs: (maxLines, fileName) => getElectronAPI().readLogs(maxLines, fileName),
  getDiagnostics: () => getElectronAPI().getDiagnostics(),
  checkLatestRelease: () => getElectronAPI().checkLatestRelease()
}
