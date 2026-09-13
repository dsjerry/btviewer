import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme, Tray, Notification } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { torrentEngine } from './torrent-engine'
import { getProgress, setProgress } from './progress-store'
import { getThumbnails, saveThumbnail } from './thumbnail-store'
import { loadSettings, saveSettings } from './settings'
import { checkForUpdates, initUpdater, installUpdate } from './updater'
import { addFeed, checkAllFeeds, checkFeed, downloadFeedItem, getFeeds, removeFeed, startPolling, updateFeed } from './rss'
import { logger } from './logger'
import type { TorrentStatus } from '../src/types'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
const isDev = !app.isPackaged

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// 原生控件（对话框、菜单）跟随设置的主题；非法值回退为跟随系统
function applyNativeTheme(theme?: string) {
  nativeTheme.themeSource = theme === 'light' || theme === 'dark' ? theme : 'system'
}

// 开机自启写系统登录项；--hidden 配合托盘静默启动
function applyLoginItem(enabled: boolean) {
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ['--hidden'] })
}

// 下载完成桌面通知（完整版 RSS 依赖此联动；可在设置关闭）
function setupCompleteNotifications() {
  torrentEngine.onTorrentComplete((_hash, name) => {
    if (loadSettings().notifyOnComplete === false || !Notification.isSupported()) return
    new Notification({ title: 'BTViewer 下载完成', body: name }).show()
  })
}

function trayIconPath() {
  const name = 'icon.png'
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), 'resources', name)
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) { void createWindow(); return }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createTray() {
  if (tray) return
  tray = new Tray(trayIconPath())
  tray.setToolTip('BTViewer')
  const menu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ])
  tray.setContextMenu(menu)
  // Windows 左键点击默认无动作，统一为唤起主窗口
  tray.on('click', showMainWindow)
}

// 真正退出：置标志后走 close → window-all-closed → shutdown 的既有清理链路
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

  // 关闭按钮默认隐藏到托盘（设置可关闭）；真正退出时放行走清理链路
  mainWindow.on('close', (event) => {
    if (!isQuitting && loadSettings().closeToTray !== false) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Window] Failed to load (${errorCode}): ${errorDescription}`)
  })

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
      const status = await torrentEngine.addTorrent(torrentId, sendStatus)
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

  ipcMain.handle('torrent:all-status', async () => torrentEngine.getAllStatuses())

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

  ipcMain.handle('thumbs:get', (_event, keys: string[]) => {
    try { return { success: true, data: getThumbnails(Array.isArray(keys) ? keys.map(String).slice(0, 200) : []) } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('thumbs:set', (_event, key: string, dataUrl: string) => {
    try { if (typeof key === 'string' && typeof dataUrl === 'string') saveThumbnail(key, dataUrl); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
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

  ipcMain.handle('updater:check', async () => {
    try { await checkForUpdates(); return { success: true } } catch (error) { return { success: false, error: getErrorMessage(error) } }
  })

  ipcMain.handle('updater:install', () => {
    installUpdate()
    return { success: true }
  })

  ipcMain.handle('dialog:open-file', async () => {    if (!mainWindow || mainWindow.isDestroyed()) {
      return { success: false, error: '窗口尚未准备好' }
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Torrent Files', extensions: ['torrent'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    try {
      const status = await torrentEngine.addTorrent(result.filePaths[0], sendStatus)
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

  ipcMain.handle('settings:set', (_event, patch: Record<string, unknown>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    applyNativeTheme(next.theme)
    applyLoginItem(next.launchOnStartup === true)
    torrentEngine.configure({ downloadDir: next.downloadDir, trackers: next.trackers, maxConcurrentDownloads: next.maxConcurrentDownloads, speedLimit: next.speedLimit })
    return { success: true, data: { ...next, downloadDir: torrentEngine.effectiveDownloadDir(), logDir: logger.logDir(), launchOnStartup: app.getLoginItemSettings().openAtLogin } }
  })

  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    const error = await shell.openPath(path)
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
  await torrentEngine.destroy()
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  // Windows 通知需要与打包配置一致的 AppUserModelID
  app.setAppUserModelId('com.btviewer.app')
  logger.cleanup()
  const settings = loadSettings()
  applyNativeTheme(settings.theme)
  torrentEngine.configure({ downloadDir: settings.downloadDir, trackers: settings.trackers, maxConcurrentDownloads: settings.maxConcurrentDownloads, speedLimit: settings.speedLimit })
  setupCompleteNotifications()
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
  // 启动自动更新（仅打包版生效）；事件推送给渲染层展示
  initUpdater((event) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:event', event)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  void shutdown().finally(() => {
    if (process.platform !== 'darwin') app.quit()
  })
})

app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault()
    void shutdown().finally(() => app.quit())
  }
})
