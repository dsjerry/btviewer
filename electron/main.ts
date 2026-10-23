import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, Tray, Notification, clipboard } from 'electron'
import { join, resolve } from 'path'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { torrentEngine } from './torrent-engine'
import { getProgress, setProgress } from './progress-store'
import { getThumbnails, saveThumbnail } from './thumbnail-store'
import { loadSettings, saveSettings } from './settings'
import { addFeed, checkAllFeeds, checkFeed, downloadFeedItem, getFeeds, removeFeed, startPolling, updateFeed } from './rss'
import { isUnderRoot, resolveAria2Binary } from './torrent-engine'
import { collectLaunchInputs } from './launch-inputs'
import { planPostAction } from './post-action'
import { createClipboardWatcher } from './clipboard-watch'
import { formatSpeed } from '../src/services/task-meta'
import { detectBinary, detectJsRuntime, clearDetectCache } from './ytdlp-engine'
import { downloadYtDlp, downloadFfmpeg, downloadDeno, updateYtDlp, seedBundledMedia, installDir, installCapabilities } from './ytdlp-installer'
import { logger, listLogFiles, readLogTail } from './logger'
import { buildDiagnostics } from './diagnostics'
import { isNewerVersion, parseLatestRelease } from './update-check'
import type { AppSettings, GlobalStat, TorrentStatus } from '../src/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const isDev = !app.isPackaged

// 单实例：第二次启动（双击种子 / 点磁力 / 重复点图标）只把输入交给已有实例后退出，
// 否则会有多个 aria2 进程、多份 tasks.json 互相打架。
// `--diagnostics` 是只读的诊断输出，不参与单实例协商（出问题时任何实例都能生成）
const isDiagnosticsRun = process.argv.includes('--diagnostics')
const hasSingleInstanceLock = isDiagnosticsRun ? false : app.requestSingleInstanceLock()
if (!hasSingleInstanceLock && !isDiagnosticsRun) {
  console.log(`[launch] 已有实例在运行，退出并把输入交给它：${process.argv.slice(1).join(' ')}`)
  app.quit()
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 原生控件（对话框、菜单）跟随设置的主题；非法值回退为跟随系统
function applyNativeTheme(theme?: string) {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
}

// 开机自启写系统登录项；--hidden 配合托盘静默启动。
// macOS 走登录项（10.13+ 的 SMAppService 需要已签名且位于 /Applications），用 openAsHidden 而不是
// path/args 传参——mac 上给登录项塞自定义 argv 不生效；Windows 仍用 arguments 附带 --hidden。
function applyLoginItem(enabled: boolean) {
  if (process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: enabled })
    return
  }
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] })
}

// 设置 → 引擎配置：映射集中在一处，避免「启动时」与「保存设置时」两个调用点漂移。
// 只有显式出现（!== undefined）的字段才会覆盖引擎值，未设置时保留引擎默认。
function engineConfig(settings: AppSettings) {
  return {
    downloadDir: settings.downloadDir,
    trackers: settings.trackers,
    maxConcurrentDownloads: settings.maxConcurrentDownloads,
    speedLimit: settings.speedLimit,
    httpSplit: settings.httpSplit,
    ytdlpPath: settings.ytdlpPath,
    proxy: settings.proxy,
    ytdlpBrowser: settings.ytdlpBrowser,
    listenPort: settings.listenPort,
    enableDht: settings.enableDht,
    enablePex: settings.enablePex,
    enableLpd: settings.enableLpd,
    btEncryption: settings.btEncryption,
    seedMode: settings.seedMode,
    seedRatio: settings.seedRatio,
    seedMinutes: settings.seedMinutes,
    streamPriority: settings.streamPriority,
    autoRetry: settings.autoRetry,
    maxRetries: settings.maxRetries
  }
}

// 下载完成桌面通知 + 完成后的动作（完整版 RSS 依赖此联动；均可在设置关闭）
function setupCompleteNotifications() {
  torrentEngine.onTorrentComplete((hash, name) => {
    const settings = loadSettings()
    if (settings.notifyOnComplete !== false && Notification.isSupported()) {
      const notification = new Notification({ title: 'BTViewer 下载完成', body: name })
      // 点通知直接跳到该任务（放到下载队列页并展开详情）
      notification.on('click', () => {
        showMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:focus-task', hash)
      })
      notification.show()
    }
    void runPostAction(settings.postAction || 'none', hash, name)
  })
  // 全局状态广播：跨会话恢复的任务（无 per-task callback）也能实时推送进度
  torrentEngine.onStatusBroadcast(sendStatus)
}

// 一键诊断（C5）：渲染层按钮与 `--diagnostics` 命令行共用同一份收集逻辑
async function collectDiagnostics(): Promise<string> {
  const settings = loadSettings()
  const statuses = torrentEngine.getAllStatuses()
  const errors = readLogTail(200).entries.filter((entry) => entry.level === 'ERROR' || entry.level === 'WARN').slice(-12).map((entry) => entry.raw)
  const [ffmpeg, ytdlp, jsRuntime] = await Promise.all([
    detectBinary(undefined, 'ffmpeg', join(app.getPath('userData'), 'bin')).catch(() => null),
    detectBinary(settings.ytdlpPath || undefined, 'yt-dlp', join(app.getPath('userData'), 'bin')).catch(() => null),
    detectJsRuntime(join(app.getPath('userData'), 'bin')).catch(() => null)
  ])
  const count = (state: TorrentStatus['status']) => statuses.filter((status) => status.status === state).length
  return buildDiagnostics({
    appVersion: app.getVersion(),
    versions: { electron: process.versions.electron || '', chrome: process.versions.chrome || '', node: process.versions.node || '' },
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    home: app.getPath('home'),
    settings: {
      downloadDir: torrentEngine.effectiveDownloadDir(),
      maxConcurrentDownloads: settings.maxConcurrentDownloads,
      speedLimit: settings.speedLimit,
      httpSplit: settings.httpSplit,
      proxy: settings.proxy,
      trackers: settings.trackers,
      ytdlpPath: settings.ytdlpPath,
      ytdlpBrowser: settings.ytdlpBrowser,
      seedMode: settings.seedMode,
      listenPort: settings.listenPort,
      streamPriority: settings.streamPriority,
      autoRetry: settings.autoRetry
    },
    network: await torrentEngine.networkStatus().catch(() => null),
    tasks: { total: statuses.length, downloading: count('downloading'), connecting: count('connecting'), parsing: count('parsing'), seeding: count('seeding'), paused: count('paused'), error: count('error') },
    binaries: {
      ffmpeg,
      ytdlp,
      jsRuntime: jsRuntime ? `${jsRuntime.name} ${jsRuntime.version || ''}`.trim() : null,
      aria2: process.env.ARIA2C_PATH || resolveAria2Binary(app.isPackaged ? join(process.resourcesPath, 'aria2') : join(app.getAppPath(), 'resources', 'aria2'))
    },
    recentErrors: errors
  })
}

// 剪贴板监听（C4）：只在应用内提示，绝不自动开始下载
let clipboardWatcher: ReturnType<typeof createClipboardWatcher> | null = null

function applyClipboardWatch(enabled: boolean) {
  if (enabled) {
    if (!clipboardWatcher) {
      clipboardWatcher = createClipboardWatcher({
        read: () => clipboard.readText(),
        onInput: (input) => {
          logger.info('clipboard', `检测到链接：${input.slice(0, 120)}`)
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:clipboard-input', input)
        }
      })
    }
    clipboardWatcher.start()
  } else {
    clipboardWatcher?.stop()
  }
}

// 完成后的动作（C3）：只在队列没有别的任务还在下载时执行；关机/睡眠都给用户留出取消窗口
async function runPostAction(action: AppSettings['postAction'] | undefined, hash: string, name: string) {
  if (!action || action === 'none') return
  const request = planPostAction(action, torrentEngine.taskSnapshot(hash), torrentEngine.pendingCount(), process.platform)
  if (!request) return
  logger.info('post-action', `${action} → ${request.kind}${request.path ? ` ${request.path}` : ''}`)
  if (request.kind === 'quit') { quitApp(); return }
  if (request.kind === 'power' && request.command) {
    // 先弹一条系统通知说明将要发生什么（关机可取消），再执行命令
    if (Notification.isSupported()) new Notification({ title: `BTViewer：${name} 已完成`, body: request.message }).show()
    try { spawn(request.command, request.args || [], { windowsHide: true, detached: true, stdio: 'ignore' }).unref() } catch (error) { logger.error('post-action', getErrorMessage(error)) }
    return
  }
  if (request.path) {
    const error = await shell.openPath(request.path)
    if (error) logger.error('post-action', `打开失败：${error}`)
    else if (Notification.isSupported()) new Notification({ title: 'BTViewer', body: request.message }).show()
  }
}

// 录制会话：渲染层 MediaRecorder 的分片经 IPC 流式写入磁盘，内存不随录制时长增长
const recordHandles = new Map<string, { stream: ReturnType<typeof createWriteStream>; path: string }>()

function closeRecordHandle(id: string, remove: boolean) {
  const handle = recordHandles.get(id)
  if (!handle) return
  recordHandles.delete(id)
  try { handle.stream.end() } catch { /* 已关闭时忽略 */ }
  if (remove) { try { rmSync(handle.path, { force: true }) } catch { /* 删除失败不影响主流程 */ } }
}

function trayIconPath() {
  // macOS 菜单栏优先用模板图（Template 后缀 + 透明底），系统会自动反色；
  // 没有模板图时 Electron 仍把普通 png 压到 16pt，但在深色菜单栏上会发糊。
  const name = process.platform === 'darwin' && existsSync(resourcePath('trayTemplate.png')) ? 'trayTemplate.png' : 'icon.png'
  return resourcePath(name)
}

function resourcePath(name: string) {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

function showMainWindow() {
  if (process.platform === 'darwin') void app.dock?.show()
  if (!mainWindow || mainWindow.isDestroyed()) { void createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// mac 菜单栏是常驻的：清空会让 ⌘C/⌘V/⌘W 全失效，所以保留最小可用的应用/编辑/窗口菜单；
// Windows/Linux 用自定义标题栏，不需要原生菜单（autoHideMenuBar 已隐藏）。
function setupAppMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: `关于 ${app.name}` },
      { type: 'separator' },
      { label: '设置…', accelerator: 'Cmd+,', click: () => focusView('settings') },
      { type: 'separator' },
      { role: 'hide', label: `隐藏 ${app.name}` },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      { label: `退出 ${app.name}`, accelerator: 'Cmd+Q', click: () => quitApp() }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
      { role: 'cut', label: '剪切' }, { role: 'copy', label: '拷贝' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }, { type: 'separator' },
      { label: '显示主窗口', accelerator: 'Cmd+0', click: showMainWindow }
    ] }
  ]))
}

// 菜单里跳转到某个视图：复用渲染层既有的导航事件
function focusView(view: string) {
  showMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:navigate', view)
}

function createTray() {
  if (tray) return
  // mac 有菜单栏与 Dock 两个入口，托盘属于可选装饰：先不建，避免菜单栏出现一个发糊的第二图标
  if (process.platform === 'darwin') return
  tray = new Tray(trayIconPath())
  tray.setToolTip('BTViewer')
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '全部暂停', click: () => void torrentEngine.pauseAll().catch((error) => logger.error('tray', getErrorMessage(error))) },
    { label: '恢复全部', click: () => void torrentEngine.resumeAll().catch((error) => logger.error('tray', getErrorMessage(error))) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  // Windows 左键点击默认无动作，统一为唤起主窗口
  tray.on('click', showMainWindow)
}

// 托盘提示实时反映全局速度与任务数（C2）；速度按 KB 取整后再比对，避免无意义刷新
let lastTrayStat = ''
function updateTrayStat(stat: GlobalStat) {
  if (!tray) return
  const signature = `${Math.round(stat.downloadSpeed / 1024)}|${Math.round(stat.uploadSpeed / 1024)}|${stat.numActive}|${stat.numWaiting}`
  if (signature === lastTrayStat) return
  lastTrayStat = signature
  const parts = ['BTViewer']
  if (stat.downloadSpeed > 0 || stat.uploadSpeed > 0) parts.push(`↓ ${formatSpeed(stat.downloadSpeed)} ↑ ${formatSpeed(stat.uploadSpeed)}`)
  const pending = stat.numActive + stat.numWaiting
  if (pending > 0) parts.push(`${pending} 个任务`)
  tray.setToolTip(parts.join(' · '))
}

// 发往渲染层的统计做同样去重，避免每秒都触发一次无变化的重渲染
let lastSentStat = ''
function forwardGlobalStat(stat: GlobalStat) {
  updateTrayStat(stat)
  if (!mainWindow || mainWindow.isDestroyed()) return
  const signature = `${Math.round(stat.downloadSpeed / 1024)}|${Math.round(stat.uploadSpeed / 1024)}|${stat.numActive}|${stat.numWaiting}|${stat.numStopped}`
  if (signature === lastSentStat) return
  lastSentStat = signature
  mainWindow.webContents.send('torrent:global-stat-update', stat)
}

// 真正退出：置标志后 app.quit()，由 before-quit → shutdown 完成清理
function quitApp() {
  isQuitting = true
  app.quit()
}

function sendStatus(status: TorrentStatus) {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('torrent:status-update', status)
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'BTViewer',
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    titleBarStyle: 'hiddenInset',
    backgroundColor: loadSettings().theme === 'light' ? '#f2f2ea' : '#11110f',
    // 自启静默启动：先隐藏窗口，由托盘唤起
    show: !process.argv.includes('--hidden')
  })

  // 关闭按钮默认隐藏到托盘（设置可关闭）；真正退出时放行走清理链路。
  // macOS 仍关闭而不是隐藏：红绿灯的「关闭」语义就是关窗，应用留在 Dock，点 Dock 图标由 activate 重建窗口。
  mainWindow.on('close', (event) => {
    if (isQuitting || process.platform === 'darwin') return
    if (loadSettings().closeToTray !== false) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Window] Failed to load (${errorCode}): ${errorDescription}`)
  })

  // 渲染层加载完成后再投递排队中的外部输入（双击种子时应用可能还没起来）
  mainWindow.webContents.on('did-finish-load', () => flushPendingInputs())

  try {
    if (isDev) {
      // electron-vite 注入的 dev server 地址，避免多实例时连到别的实例
      await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173')
    } else {
      await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
    }
  } catch (error) {
    console.error('[Window] Load error:', getErrorMessage(error))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function setupIPC() {
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize()
    return { success: true }
  })

  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return { success: false }
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    else mainWindow.maximize()
    return { success: true, maximized: mainWindow.isMaximized() }
  })

  ipcMain.handle('window:close', () => {
    mainWindow?.close()
    return { success: true }
  })

  ipcMain.handle('torrent:add', async (_event, torrentId: string) => {
    try {
      const status = await torrentEngine.addTask(torrentId, sendStatus)
      return { success: true, data: status }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:remove', async (_event, infoHash: string, destroy = false) => {
    try {
      await torrentEngine.removeTorrent(infoHash, destroy)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:pause', async (_event, infoHash: string) => {
    try {
      await torrentEngine.pauseTorrent(infoHash)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:resume', async (_event, infoHash: string) => {
    try {
      await torrentEngine.resumeTorrent(infoHash)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:download', async (_event, infoHash: string, filePaths?: string[]) => {
    try {
      await torrentEngine.downloadTorrent(infoHash, filePaths)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 失败重试：清掉 aria2 结果记录（保留磁盘数据）后按原来源重新入队
  ipcMain.handle('torrent:retry', async (_event, infoHash: string) => {
    try {
      return { success: true, data: await torrentEngine.retryTorrent(infoHash) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 单任务限速：'0' 或空串表示取消限速
  ipcMain.handle('torrent:set-speed-limit', async (_event, infoHash: string, limit: string) => {
    try {
      await torrentEngine.setTaskSpeedLimit(infoHash, String(limit ?? ''))
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:move', async (_event, infoHash: string, action: 'top' | 'up' | 'down') => {
    try {
      await torrentEngine.moveTask(infoHash, action)
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:pause-all', async () => {
    try {
      return { success: true, data: await torrentEngine.pauseAll() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:resume-all', async () => {
    try {
      return { success: true, data: await torrentEngine.resumeAll() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 边下边播：播放/拖动时把待播位置标为优先分片
  ipcMain.handle('torrent:prioritize-stream', async (_event, infoHash: string, offsetBytes?: number) => {
    try {
      return { success: true, data: await torrentEngine.prioritizeStream(infoHash, Number(offsetBytes) || 0) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:peers', async (_event, infoHash: string) => {
    try {
      return { success: true, data: await torrentEngine.taskPeers(infoHash) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:trackers', async (_event, infoHash: string) => {
    try {
      return { success: true, data: await torrentEngine.taskTrackers(infoHash) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('engine:network-status', async () => {
    try {
      return { success: true, data: await torrentEngine.networkStatus() }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 兼容播放（B1）：内置播放器解不了的编码，用 ffmpeg 生成可播放副本
  ipcMain.handle('media:compat-plan', async (_event, infoHash: string, filePath: string, audioIndex?: number) => {
    try {
      return { success: true, data: await torrentEngine.compatPlan(infoHash, filePath, Number(audioIndex) || 0) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('media:compat-start', async (_event, infoHash: string, filePath: string, audioIndex?: number) => {
    try {
      return { success: true, data: await torrentEngine.compatStart(infoHash, filePath, Number(audioIndex) || 0) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('media:compat-url', (_event, id: string) => {
    try {
      return { success: true, data: torrentEngine.compatUrl(id) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('media:compat-cancel', (_event, id: string) => {
    torrentEngine.compatCancel(id)
    return { success: true }
  })

  // 批量入队（多链接粘贴 / 多文件拖放）：不等待 metadata，一次返回汇总
  ipcMain.handle('torrent:add-batch', async (_event, inputs: string[]) => {
    try {
      return { success: true, data: await torrentEngine.addTasksBatch(Array.isArray(inputs) ? inputs.map(String) : []) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 任务清单导出：.json 便于再次导入，.txt 一行一个链接便于分享（按用户在保存对话框里选的扩展名决定）
  ipcMain.handle('tasks:export', async () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '窗口尚未准备好' }
      const tasks = torrentEngine.exportTaskList()
      const stamp = new Date().toISOString().slice(0, 10)
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出任务清单',
        defaultPath: join(app.getPath('downloads'), `btviewer-tasks-${stamp}.json`),
        filters: [{ name: '任务清单（可再次导入）', extensions: ['json'] }, { name: '链接清单（一行一个链接）', extensions: ['txt'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, canceled: true }
      const isText = result.filePath.toLowerCase().endsWith('.txt')
      const body = isText
        ? `# BTViewer 任务清单（一行一个链接）\n${tasks.map((task) => task.source).join('\n')}\n`
        : JSON.stringify({ app: 'BTViewer', version: 1, exportedAt: new Date().toISOString(), tasks }, null, 2)
      writeFileSync(result.filePath, body, 'utf8')
      return { success: true, data: { path: result.filePath, count: tasks.length } }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 任务清单导入：兼容本应用导出的 .json 与「一行一个链接」的 .txt；已存在的来源会跳过
  ipcMain.handle('tasks:import', async () => {
    try {
      if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '窗口尚未准备好' }
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '导入任务清单',
        properties: ['openFile'],
        filters: [{ name: '任务清单 / 链接清单', extensions: ['json', 'txt'] }]
      })
      if (result.canceled || !result.filePaths.length) return { success: false, canceled: true }
      const file = result.filePaths[0]
      const text = readFileSync(file, 'utf8')
      let sources: string[] = []
      if (file.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text) as { tasks?: Array<{ source?: string }> }
        sources = (parsed.tasks || []).map((task) => String(task.source || ''))
      } else {
        sources = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => !!line && !line.startsWith('#'))
      }
      const summary = await torrentEngine.importTaskList(sources)
      return { success: true, data: summary }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 网络类设置（监听端口/DHT/PEX/LPD/加密）改动后需要重启 aria2 才能生效
  ipcMain.handle('engine:restart', async () => {
    try {
      await torrentEngine.restartEngine()
      return { success: true }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:all-status', async () => torrentEngine.getAllStatuses())

  // 全局统计（C2）：渲染层首次挂载时主动取一次，之后靠推送
  ipcMain.handle('torrent:global-stat', async () => {
    try { return { success: true, data: await torrentEngine.getGlobalStat() } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  // yt-dlp 可用性检测（设置页展示状态与版本）；同时检测 JS 运行时（解 YouTube 签名挑战所需）
  ipcMain.handle('ytdlp:check', async (_event, customPath?: string) => {
    try {
      clearDetectCache()
      const binary = await detectBinary(customPath || undefined, 'yt-dlp', join(app.getPath('userData'), 'bin'))
      const ffmpeg = binary ? await detectBinary(undefined, 'ffmpeg', join(app.getPath('userData'), 'bin')) : null
      const jsRuntime = binary ? await detectJsRuntime(join(app.getPath('userData'), 'bin')) : null
      return { success: true, data: { available: !!binary, path: binary || '', ffmpegAvailable: !!ffmpeg, jsRuntime, capabilities: installCapabilities() } }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // yt-dlp 自动安装：从官方 Release 下载到 userData/bin，进度实时推送渲染层
  ipcMain.handle('ytdlp:install', async () => {
    try {
      const path = await downloadYtDlp(installDir(), (received, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ytdlp:install-progress', { received, total })
      })
      clearDetectCache()
      return { success: true, data: path }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // yt-dlp 自更新（-U，仅 exe 版支持）
  ipcMain.handle('ytdlp:update', async (_event, binaryPath: string) => {
    try { return { success: true, data: await updateYtDlp(String(binaryPath)) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  // ffmpeg 自动安装：gyan.dev 官方构建解压到 userData/bin，进度实时推送；装完自动重试出错的视频任务
  ipcMain.handle('ffmpeg:install', async () => {
    try {
      const path = await downloadFfmpeg(installDir(), (received, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('ffmpeg:install-progress', { received, total })
      })
      clearDetectCache()
      torrentEngine.retryErroredVideos()
      return { success: true, data: path }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // deno 自动安装：yt-dlp 解 YouTube 签名挑战所需的 JS 运行时；装完自动重试出错的视频任务
  ipcMain.handle('deno:install', async () => {
    try {
      const path = await downloadDeno(installDir(), (received, total) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('deno:install-progress', { received, total })
      })
      clearDetectCache()
      torrentEngine.retryErroredVideos()
      return { success: true, data: path }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('torrent:get-stream-url', async (_event, infoHash: string, filePath: string) => {
    return torrentEngine.getStreamUrl(infoHash, filePath)
  })

  ipcMain.handle('torrent:get-subtitle-url', (_event, infoHash: string, filePath: string) => {
    return torrentEngine.getSubtitleUrl(infoHash, filePath)
  })

  ipcMain.handle('progress:get', (_event, infoHash: string, filePath: string) => {
    return getProgress(infoHash, filePath)
  })

  ipcMain.handle('progress:set', (_event, infoHash: string, filePath: string, position: number, duration: number) => {
    setProgress(infoHash, filePath, position, duration)
  })

  // 点系统通知跳转到对应任务
  ipcMain.handle('clipboard:ignore', (_event, input: string) => {
    clipboardWatcher?.ignore(String(input || ''))
    return { success: true }
  })

  // 轻量更新检查（C7）：只读 GitHub Releases API 并比较版本，不做任何自动下载/安装
  ipcMain.handle('update:check', async () => {
    try {
      const response = await fetch('https://api.github.com/repos/dsjerry/btviewer/releases/latest', {
        headers: { 'user-agent': `BTViewer/${app.getVersion()}`, accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000)
      })
      if (!response.ok) return { success: false, error: response.status === 404 ? '仓库还没有发布 Release' : `GitHub 返回 ${response.status}` }
      const release = parseLatestRelease(await response.text())
      if (!release) return { success: false, error: '无法解析 Release 信息' }
      const current = app.getVersion()
      return { success: true, data: { ...release, current, hasUpdate: isNewerVersion(release.version, current) } }
    } catch (error) {
      return { success: false, error: `检查更新失败：${getErrorMessage(error)}` }
    }
  })

  // 运行日志（C5）：只读日志目录里的文件，fileName 必须在列出的清单内
  ipcMain.handle('logs:list', () => ({ success: true, data: listLogFiles() }))
  ipcMain.handle('logs:read', (_event, maxLines?: number, fileName?: string) => {
    try {
      const known = listLogFiles().some((file) => file.name === fileName)
      return { success: true, data: readLogTail(Number(maxLines) || 400, fileName && known ? fileName : undefined) }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 一键诊断：版本/引擎/设置/任务概况/最近错误，拼成可复制文本（含脱敏）
  ipcMain.handle('diagnostics:get', async () => {
    try { return { success: true, data: await collectDiagnostics() } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('thumbs:get', (_event, keys: string[]) => {
    try { return { success: true, data: getThumbnails(Array.isArray(keys) ? keys.map(String).slice(0, 200) : []) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('thumbs:set', (_event, key: string, dataUrl: string) => {
    try { if (typeof key === 'string' && typeof dataUrl === 'string') saveThumbnail(key, dataUrl); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  // 内嵌封面（B7）：媒体文件自带封面时优先用它，比截帧更准也更快；没有则返回 null 由渲染层截帧兜底
  ipcMain.handle('thumbs:cover', async (_event, infoHash: string, filePath: string) => {
    try { return { success: true, data: await torrentEngine.extractCover(infoHash, filePath) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('feeds:get', () => ({ success: true, data: getFeeds() }))
  ipcMain.handle('feeds:add', (_event, input: Parameters<typeof addFeed>[0]) => {
    try { return { success: true, data: addFeed(input) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })
  ipcMain.handle('feeds:update', (_event, id: string, patch: Record<string, unknown>) => {
    try { return { success: true, data: updateFeed(id, patch) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })
  ipcMain.handle('feeds:remove', (_event, id: string) => {
    try { removeFeed(id); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })
  ipcMain.handle('feeds:check', async (_event, id: string) => {
    try { return { success: true, data: id === 'all' ? await checkAllFeeds() : [await checkFeed(id)] } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })
  ipcMain.handle('feeds:download-item', async (_event, feedId: string, guid: string) => {
    try { await downloadFeedItem(feedId, guid); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  // 播放器截图/录制内容落盘：渲染层传 dataURL，弹系统保存对话框后写文件
  ipcMain.handle('media:save', async (_event, defaultName: string, dataUrl: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '窗口尚未准备好' }
    const match = /^data:[^;,]+;base64,([A-Za-z\d+/=]+)$/.exec(typeof dataUrl === 'string' ? dataUrl : '')
    if (!match) return { success: false, error: '数据格式无效' }
    const name = String(defaultName || 'export').replace(/[\\/:*?"<>|]/g, '_')
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try { writeFileSync(result.filePath, Buffer.from(match[1], 'base64')); return { success: true, data: result.filePath } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  // 录制：先选保存路径，之后分片流式写入（结构化克隆传输，无 base64 膨胀）
  ipcMain.handle('media:record-begin', async (_event, defaultName: string) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '窗口尚未准备好' }
    const name = String(defaultName || 'record').replace(/[\\/:*?"<>|]/g, '_')
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: name, filters: [{ name: 'WebM 视频', extensions: ['webm'] }] })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    const id = randomUUID()
    recordHandles.set(id, { stream: createWriteStream(result.filePath), path: result.filePath })
    return { success: true, data: { id, path: result.filePath } }
  })

  ipcMain.handle('media:record-append', (_event, id: string, chunk: Uint8Array) => {
    const handle = recordHandles.get(String(id))
    if (!handle) return { success: false, error: '录制会话不存在' }
    try { handle.stream.write(Buffer.from(chunk)); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('media:record-end', (_event, id: string) => {
    const handle = recordHandles.get(String(id))
    if (!handle) return { success: false, error: '录制会话不存在' }
    handle.stream.end()
    recordHandles.delete(String(id))
    return { success: true, data: handle.path }
  })

  ipcMain.handle('media:record-abort', (_event, id: string) => {
    closeRecordHandle(String(id), true)
    return { success: true }
  })

  ipcMain.handle('dialog:open-file', async () => {    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: '窗口尚未准备好' }
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Torrent / Metalink Files', extensions: ['torrent', 'metalink', 'meta4'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const status = await torrentEngine.addTask(result.filePaths[0], sendStatus)
      return { success: true, data: status }
    } catch (error) {
      return { success: false, error: getErrorMessage(error) }
    }
  })

  ipcMain.handle('dialog:pick-download-dir', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: '窗口尚未准备好' }
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true }
    return { success: true, data: result.filePaths[0] }
  })

  ipcMain.handle('settings:get', () => ({ success: true, data: { ...loadSettings(), downloadDir: torrentEngine.effectiveDownloadDir(), logDir: logger.logDir(), launchOnStartup: app.getLoginItemSettings().openAtLogin } }))
  // 自动安装/内置资源的可用性：设置页据此决定显示「一键安装」还是平台说明，避免向用户抛 pip/brew 之类的命令
  ipcMain.handle('installer:capabilities', () => ({ success: true, data: installCapabilities() }))

  ipcMain.handle('settings:set', (_event, patch: Record<string, unknown>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    applyNativeTheme(next.theme)
    applyLoginItem(next.launchOnStartup === true)
    applyMagnetRegistration(next.registerMagnet === true)
    applyClipboardWatch(next.clipboardWatch === true)
    torrentEngine.configure(engineConfig(next))
    return { success: true, data: { ...next, downloadDir: torrentEngine.effectiveDownloadDir(), logDir: logger.logDir(), launchOnStartup: app.getLoginItemSettings().openAtLogin } }
  })

  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    // 只允许打开下载目录和日志目录内的路径，避免渲染层被注入后任意打开文件
    const target = resolve(String(path || ''))
    const allowedRoots = [torrentEngine.effectiveDownloadDir(), logger.logDir()].filter(Boolean).map((root) => resolve(root))
    const allowed = allowedRoots.some((root) => target === root || isUnderRoot(root, target))
    if (!allowed) return { success: false, error: '仅允许打开下载目录或日志目录内的路径' }
    const error = await shell.openPath(target)
    return error ? { success: false, error } : { success: true }
  })

  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (!/^https?:\/\//i.test(url)) return { success: false, error: '仅允许打开 http(s) 链接' }
    await shell.openExternal(url)
    return { success: true }
  })
}

async function shutdown() {
  if (isQuitting) return
  isQuitting = true
  // 收尾未完成的录制句柄（半成品文件保留在磁盘，由用户自行处理）
  for (const id of [...recordHandles.keys()]) closeRecordHandle(id, false)
  await torrentEngine.destroy()
}

// ── 单实例与外部输入（C1）──────────────────────────────────────────
// 待处理的外部输入（双击种子 / 点网页磁力 / 命令行传入）：窗口就绪后立刻投递，否则排队
const pendingInputs: string[] = []
let rendererReady = false

function deliverInputs(inputs: string[]) {
  const list = collectLaunchInputs(inputs)
  if (!list.length) return
  for (const input of list) logger.info('launch', `收到外部输入：${input.slice(0, 120)}`)
  if (!rendererReady || !mainWindow || mainWindow.isDestroyed()) { pendingInputs.push(...list); return }
  showMainWindow()
  for (const input of list) mainWindow.webContents.send('app:open-input', input)
}

function flushPendingInputs() {
  rendererReady = true
  while (pendingInputs.length) {
    const input = pendingInputs.shift()!
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('app:open-input', input)
  }
}

// 磁力协议注册：默认不动系统设置，由用户显式开启（否则会抢掉其它 BT 客户端的默认关联）。
// 开发模式下必须显式带上入口脚本，否则注册出来的是 electron 可执行文件本身。
function applyMagnetRegistration(enabled: boolean) {
  try {
    const devArgs = process.defaultApp && process.argv[1] ? [resolve(process.argv[1])] : []
    if (enabled) app.setAsDefaultProtocolClient('magnet', process.execPath, devArgs)
    else app.removeAsDefaultProtocolClient('magnet', process.execPath, devArgs)
  } catch (error) { logger.warn('launch', `磁力协议注册失败：${getErrorMessage(error)}`) }
}

app.whenReady().then(async () => {
  // 命令行诊断输出：打印到 stdout 后退出，不起窗口也不起 aria2（支持让用户直接发回这份文本）
  if (isDiagnosticsRun) {
    try { console.log(await collectDiagnostics()) } catch (error) { console.error(getErrorMessage(error)) }
    app.quit()
    return
  }
  // 没抢到单实例锁的进程直接退出，不做任何启动工作（不起 aria2、不建窗口）
  if (!hasSingleInstanceLock) return
  setupAppMenu()
  // Windows 通知需要与打包配置一致的 AppUserModelID
  app.setAppUserModelId('com.btviewer.app')
  logger.cleanup()
  logger.info('launch', `启动参数：${process.argv.slice(1).join(' ')}`)
  const settings = loadSettings()
  applyNativeTheme(settings.theme)
  // 安装包内置的 ffmpeg/ffprobe（macOS）在这里落到 userData/bin：用户装完即可用，不需要任何命令行操作
  const seeded = seedBundledMedia()
  if (seeded.length) logger.info('launch', `已就绪内置媒体工具：${seeded.join(', ')}`)
  applyMagnetRegistration(settings.registerMagnet === true)
  applyClipboardWatch(settings.clipboardWatch === true)
  torrentEngine.configure(engineConfig(settings))
  setupCompleteNotifications()
  // 兼容播放进度：转封装/转码是长任务，进度实时推给渲染层
  torrentEngine.onCompatProgress((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('media:compat-progress', event)
  })
  // 全局上下行与任务数：推给渲染层侧边栏，同时刷新托盘提示
  torrentEngine.onGlobalStat(forwardGlobalStat)
  setupIPC()
  try {
    const serverPort = await torrentEngine.startServer()
    console.log(`[Main] Torrent server started on port ${serverPort}`)
  } catch (error) {
    console.error('[Main] Failed to start torrent server:', getErrorMessage(error))
  }
  await createWindow()
  createTray()
  // RSS 订阅轮询（后台静默进行，结果进 feeds.json）
  startPolling()
  // 首次启动时命令行里带的种子/磁力（含打包后的文件关联双击）
  deliverInputs(process.argv.slice(1))

  // 点 Dock 图标 / ⌘Tab 切回来：窗口可能已关闭（mac 关闭窗口 = 关窗不退出），重建即可
  app.on('activate', () => { showMainWindow() })
})

// 二次启动（双击种子、点磁力链接、重复点图标）：把输入交给已有实例，然后自己退出
app.on('second-instance', (_event, argv) => {
  showMainWindow()
  deliverInputs(argv.slice(1))
})

// macOS 的协议/文件关联走事件而不是命令行
app.on('open-url', (event, url) => { event.preventDefault(); deliverInputs([url]) })
app.on('open-file', (event, path) => { event.preventDefault(); deliverInputs([path]) })

// 窗口全部关闭：mac 留在 Dock（点图标由 activate 重建窗口），Windows 留在托盘，都只停 aria2/转码、不退出进程。
// 真正退出由托盘「退出」/菜单「退出 ⌘Q」/before-quit 负责。
app.on('window-all-closed', () => {
  void shutdown().finally(() => {
    // Linux/Windows 无托盘（closeToTray 关闭或托盘创建失败）且没有常驻入口时，隐藏窗口会让进程永远驻留；
    // 其它平台仍保留驻留，供托盘/菜单栏再次唤起。
    if (process.platform !== 'darwin' && !tray) app.quit()
  })
})

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault()
    void shutdown().finally(() => app.quit())
  }
})
