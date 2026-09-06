import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron'
import { join } from 'path'
import { torrentEngine } from './torrent-engine'
import { loadSettings, saveSettings } from './settings'
import type { TorrentStatus } from '../src/types'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
const isDev = !app.isPackaged

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    backgroundColor: '#0b1020'
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

  ipcMain.handle('settings:get', () => ({ success: true, data: { ...loadSettings(), downloadDir: torrentEngine.effectiveDownloadDir() } }))

  ipcMain.handle('settings:set', (_event, patch: Record<string, unknown>) => {
    const next = { ...loadSettings(), ...patch }
    saveSettings(next)
    torrentEngine.configure({ downloadDir: next.downloadDir, trackers: next.trackers, maxConcurrentDownloads: next.maxConcurrentDownloads })
    return { success: true, data: { ...next, downloadDir: torrentEngine.effectiveDownloadDir() } }
  })

  ipcMain.handle('shell:open-path', async (_event, path: string) => {
    const error = await shell.openPath(path)
    return error ? { success: false, error } : { success: true }
  })
}

async function shutdown() {
  if (isQuitting) return
  isQuitting = true
  await torrentEngine.destroy()
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  const settings = loadSettings()
  torrentEngine.configure({ downloadDir: settings.downloadDir, trackers: settings.trackers, maxConcurrentDownloads: settings.maxConcurrentDownloads })
  setupIPC()
  try {
    const serverPort = await torrentEngine.startServer()
    console.log(`[Main] Torrent server started on port ${serverPort}`)
  } catch (error) {
    console.error('[Main] Failed to start torrent server:', getErrorMessage(error))
  }
  await createWindow()

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
