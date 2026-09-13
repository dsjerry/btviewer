import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ipc } from './services/ipc'
import Home from './components/Home'
import FileList from './components/FileList'
import Player from './components/Player'
import DownloadManager from './components/DownloadManager'
import Settings from './components/Settings'
import Feeds from './components/Feeds'
import ErrorBoundary from './components/ErrorBoundary'
import type { ThemeMode, TorrentStatus, TorrentFileInfo } from './types'
import { applyTheme, watchSystemTheme } from './services/theme'

type ViewMode = 'home' | 'files' | 'downloads' | 'feeds' | 'player' | 'settings'
// 侧边栏图标统一规格：20 视图框、1.5 描边、圆角连接，颜色跟随 currentColor
const navIconProps = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const navItems: Array<{ key: ViewMode; label: string; icon: React.ReactNode }> = [
  { key: 'home', label: '首页', icon: <svg {...navIconProps}><path d="M3.5 8.5L10 3l6.5 5.5V16a1 1 0 01-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 01-1-1z" /></svg> },
  { key: 'files', label: '媒体库', icon: <svg {...navIconProps}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></svg> },
  { key: 'downloads', label: '下载任务', icon: <svg {...navIconProps}><path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5" /><path d="M3.5 14.5v1.5a1 1 0 001 1h11a1 1 0 001-1v-1.5" /></svg> },
  { key: 'feeds', label: '订阅', icon: <svg {...navIconProps}><circle cx="5.2" cy="14.8" r="1.6" fill="currentColor" stroke="none" /><path d="M3.8 9.2a7 7 0 017 7" /><path d="M3.8 4.2a12 12 0 0112 12" /></svg> },
  { key: 'settings', label: '设置', icon: <svg {...navIconProps}><path d="M3 5.5h14M3 10h14M3 14.5h14" /><circle cx="8" cy="5.5" r="1.8" fill="currentColor" stroke="none" /><circle cx="13" cy="10" r="1.8" fill="currentColor" stroke="none" /><circle cx="7" cy="14.5" r="1.8" fill="currentColor" stroke="none" /></svg> }
]

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const [torrents, setTorrents] = useState<TorrentStatus[]>([])
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [playingFile, setPlayingFile] = useState<TorrentFileInfo | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 自动更新：下载完成后顶部提示，用户确认后重启安装
  const [updateReady, setUpdateReady] = useState<string | null>(null)
  // 外观主题：启动时从设置读取，变更立即应用并持久化
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  useEffect(() => { void (async () => { try { const result = await ipc.getSettings(); if (result.success && result.data?.theme) setThemeMode(result.data.theme) } catch { /* 读不到设置时保持跟随系统 */ } })() }, [])
  useEffect(() => { applyTheme(themeMode); return watchSystemTheme(themeMode) }, [themeMode])
  const changeTheme = (mode: ThemeMode) => { setThemeMode(mode); void ipc.saveSettings({ theme: mode }).catch(() => undefined) }
  useEffect(() => {
    try { return ipc.onUpdaterEvent((event) => { if (event.type === 'downloaded') setUpdateReady(event.version || '') }) } catch { return () => undefined }
  }, [])
  const refreshStatuses = useCallback(async () => { try { setTorrents(await ipc.getAllStatuses()); setLoadError(null) } catch (error) { setLoadError(error instanceof Error ? error.message : '无法连接到后台服务') } finally { setLoading(false) } }, [])
  useEffect(() => { let unsubscribe: () => void = () => undefined; try { unsubscribe = ipc.onStatusUpdate((status) => setTorrents((current) => [...current.filter((item) => item.infoHash !== status.infoHash), status].sort((a, b) => a.name.localeCompare(b.name)))); void refreshStatuses() } catch (error) { setLoadError(error instanceof Error ? error.message : '应用初始化失败'); setLoading(false) }; const timer = window.setInterval(() => void refreshStatuses(), 10000); return () => { unsubscribe(); window.clearInterval(timer) } }, [refreshStatuses])
  const selectedTorrent = useMemo(() => torrents.find((torrent) => torrent.infoHash === selectedHash) ?? null, [selectedHash, torrents])
  // 可挂载到播放器的字幕：Chromium 原生只渲染 VTT（srt 由主进程转换），ass/ssa/sub 暂不支持
  const attachableSubtitles = useMemo(() => selectedTorrent?.files.filter((file) => file.type === 'subtitle' && /\.(srt|vtt)$/i.test(file.name)) ?? [], [selectedTorrent])
  // 播放列表：当前任务的全部可播媒体，按文件名自然排序（S01E02 会排在 S01E10 前）
  const playableFiles = useMemo(() => (selectedTorrent?.files.filter((file) => file.type === 'video' || file.type === 'audio') ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })), [selectedTorrent])
  const activeCount = torrents.filter((torrent) => torrent.status === 'downloading' || torrent.status === 'connecting').length
  const selectTorrent = (torrent: TorrentStatus) => { setSelectedHash(torrent.infoHash); setViewMode('files') }
  const added = (status?: TorrentStatus) => { if (status) setSelectedHash(status.infoHash); void refreshStatuses(); setViewMode(status ? 'files' : 'downloads') }
  const startPlay = async (status: TorrentStatus, file: TorrentFileInfo) => {
    setSelectedHash(status.infoHash)
    setPlayingFile(file)
    setViewMode('player')
    const result = await ipc.downloadTorrent(status.infoHash, [file.path])
    if (!result.success) setLoadError(result.error || '启动媒体下载失败')
  }
  const playParsedFile = (status: TorrentStatus, file: TorrentFileInfo) => void startPlay(status, file)
  // 播放器内切换（上一集/下一集/连播）：同任务文件间切换，保持任务选中状态
  const switchPlayFile = async (file: TorrentFileInfo) => {
    if (!selectedTorrent) return
    setPlayingFile(file)
    const result = await ipc.downloadTorrent(selectedTorrent.infoHash, [file.path])
    if (!result.success) setLoadError(result.error || '启动媒体下载失败')
  }
  const removeTorrent = async (torrent: TorrentStatus, destroy: boolean) => {
    const result = await ipc.removeTorrent(torrent.infoHash, destroy)
    if (!result.success) { setLoadError(result.error || '删除失败'); return }
    if (selectedHash === torrent.infoHash) { setSelectedHash(null); setPlayingFile(null) }
    await refreshStatuses()
  }
  const downloadParsedTask = async (status: TorrentStatus, filePaths?: string[]) => { const result = await ipc.downloadTorrent(status.infoHash, filePaths); if (!result.success) { setLoadError(result.error || '开始下载失败'); return }; await refreshStatuses(); setViewMode('downloads') }
  const content = <ErrorBoundary>{loading ? <div className="page-center"><div className="loading-spinner" /><span>正在连接 BT 服务…</span></div> : viewMode === 'home' ? <Home onTorrentAdded={added} onPlayFile={playParsedFile} onDownload={(status, filePaths) => void downloadParsedTask(status, filePaths)} /> : viewMode === 'downloads' ? <DownloadManager torrents={torrents} onRefresh={refreshStatuses} onSelect={selectTorrent} /> : viewMode === 'feeds' ? <Feeds /> : viewMode === 'settings' ? <Settings theme={themeMode} onThemeChange={changeTheme} /> : viewMode === 'player' && selectedTorrent && playingFile ? <Player infoHash={selectedTorrent.infoHash} file={playingFile} subtitles={attachableSubtitles} playlist={playableFiles} onSelectFile={(file) => void switchPlayFile(file)} onBack={() => { setPlayingFile(null); setViewMode('files') }} /> : <FileList torrent={selectedTorrent} torrents={torrents} onSelectTorrent={selectTorrent} onPlayFile={(file) => { if (selectedTorrent) void startPlay(selectedTorrent, file) }} onRemove={(torrent, destroy) => void removeTorrent(torrent, destroy)} onBack={() => setSelectedHash(null)} />}</ErrorBoundary>
  return <div className="app-shell"><aside className={`app-sidebar ${collapsed ? 'is-collapsed' : ''}`}><div className="brand"><svg className="brand-mark" viewBox="0 0 512 512" aria-label="BTViewer"><defs><linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e1f17"/><stop offset="1" stopColor="#0f0f09"/></linearGradient><linearGradient id="brand-lime" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eaff93"/><stop offset="1" stopColor="#c3e040"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#brand-bg)"/><rect x="151" y="151" width="210" height="210" rx="34" transform="rotate(45 256 256)" fill="url(#brand-lime)"/><path d="M 219 190 L 343 256 L 219 322 Z" fill="#131309"/></svg><span className="brand-name">BT<span>Viewer</span></span></div><nav className="main-nav">{navItems.map((item) => <button key={item.key} className={`nav-item ${(viewMode === item.key || (viewMode === 'player' && item.key === 'files')) ? 'is-active' : ''}`} onClick={() => setViewMode(item.key)}><span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>{item.key === 'downloads' && activeCount > 0 && <b className="nav-count">{activeCount}</b>}</button>)}</nav><div className="sidebar-bottom"><span className="online-dot" />{!collapsed && <span>本地服务在线</span>}</div></aside><main className="app-main"><header className="topbar"><div className="window-drag"><span className="window-title">BTViewer</span></div><div className="topbar-right"><button className="refresh-button no-drag" onClick={() => void refreshStatuses()}><span>↻</span> 刷新</button><div className="window-controls no-drag"><button onClick={() => void ipc.minimizeWindow()} aria-label="最小化"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg></button><button onClick={() => void ipc.toggleMaximizeWindow()} aria-label="最大化"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg></button><button className="close-control" onClick={() => void ipc.closeWindow()} aria-label="关闭"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg></button></div></div></header>{loadError && <div className="error-banner"><span>!</span>{loadError}<button onClick={() => setLoadError(null)}>×</button></div>}{updateReady !== null && <div className="update-banner"><span>◉</span><span>新版本 {updateReady || ''} 已下载就绪</span><button className="banner-apply" onClick={() => void ipc.installUpdate()}>重启更新</button><button className="banner-dismiss" onClick={() => setUpdateReady(null)}>×</button></div>}<section className="content-area">{content}</section></main></div>
}
export default App
