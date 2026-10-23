import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ipc } from './services/ipc'
import Home from './components/Home'
import FileList from './components/FileList'
import DownloadManager from './components/DownloadManager'
import Settings from './components/Settings'
import Feeds from './components/Feeds'
import ErrorBoundary from './components/ErrorBoundary'
import type { GlobalStat, Language, PlaylistEntry, ThemeMode, TorrentStatus, TorrentFileInfo } from './types'
import { applyTheme, watchSystemTheme } from './services/theme'
import { setLanguage as applyLanguage, t } from './services/i18n'
import { formatSpeed } from './services/task-meta'
import { buildPlaylist } from './services/playlist'

type ViewMode = 'home' | 'files' | 'downloads' | 'feeds' | 'player' | 'settings'
// 任务列表固定按名称排序；返回新数组避免原地排序改变身份
const sortStatuses = (list: TorrentStatus[]) => [...list].sort((a, b) => a.name.localeCompare(b.name))
// 侧边栏图标统一规格：20 视图框、1.5 描边、圆角连接，颜色跟随 currentColor
const navIconProps = { width: 18, height: 18, viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const
const navItems: Array<{ key: ViewMode; labelKey: string; icon: React.ReactNode }> = [
  { key: 'home', labelKey: 'nav.home', icon: <svg {...navIconProps}><path d="M3.5 8.5L10 3l6.5 5.5V16a1 1 0 01-1 1h-3.5v-4.5h-4V17H4.5a1 1 0 01-1-1z" /></svg> },
  { key: 'files', labelKey: 'nav.files', icon: <svg {...navIconProps}><rect x="3" y="3" width="6" height="6" rx="1" /><rect x="11" y="3" width="6" height="6" rx="1" /><rect x="3" y="11" width="6" height="6" rx="1" /><rect x="11" y="11" width="6" height="6" rx="1" /></svg> },
  { key: 'downloads', labelKey: 'nav.downloads', icon: <svg {...navIconProps}><path d="M10 3v9m0 0l-3.5-3.5M10 12l3.5-3.5" /><path d="M3.5 14.5v1.5a1 1 0 001 1h11a1 1 0 001-1v-1.5" /></svg> },
  { key: 'feeds', labelKey: 'nav.feeds', icon: <svg {...navIconProps}><circle cx="5.2" cy="14.8" r="1.6" fill="currentColor" stroke="none" /><path d="M3.8 9.2a7 7 0 017 7" /><path d="M3.8 4.2a12 12 0 0112 12" /></svg> },
  { key: 'settings', labelKey: 'nav.settings', icon: <svg {...navIconProps}><path d="M3 5.5h14M3 10h14M3 14.5h14" /><circle cx="8" cy="5.5" r="1.8" fill="currentColor" stroke="none" /><circle cx="13" cy="10" r="1.8" fill="currentColor" stroke="none" /><circle cx="7" cy="14.5" r="1.8" fill="currentColor" stroke="none" /></svg> }
]

// 播放器携带 video.js（体积大头），懒加载拆分为独立 chunk，缩短首屏加载
const Player = React.lazy(() => import('./components/Player'))

const App: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('home')
  const [torrents, setTorrents] = useState<TorrentStatus[]>([])
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [playingFile, setPlayingFile] = useState<TorrentFileInfo | null>(null)
  // 侧边栏折叠：点击品牌区切换，偏好持久化（与媒体库视图偏好一致）
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('btviewer-sidebar-collapsed') === '1')
  const toggleCollapsed = useCallback(() => setCollapsed((current) => { const next = !current; localStorage.setItem('btviewer-sidebar-collapsed', next ? '1' : '0'); return next }), [])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // 首页解析中的任务 hash：提升到 App 级，切页后回来可恢复解析视图（任务状态从 torrents 实时派生）
  const [parsingHash, setParsingHash] = useState<string | null>(null)
  // 外观主题：启动时从设置读取，变更立即应用并持久化
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  // 全局统计（C2）：侧边栏实时上下行；全局限速快速控制
  const [globalStat, setGlobalStat] = useState<GlobalStat | null>(null)
  const [speedLimit, setSpeedLimit] = useState('')
  const [limitOpen, setLimitOpen] = useState(false)
  // 界面语言（C6）：启动时从设置读取；切换后由本组件的重渲染带动整棵子树更新
  const [language, setLanguageState] = useState<Language>('zh')
  useEffect(() => {
    void (async () => {
      try {
        const result = await ipc.getSettings()
        if (!result.success || !result.data) return
        if (result.data.theme) setThemeMode(result.data.theme)
        if (result.data.language) { setLanguageState(result.data.language); applyLanguage(result.data.language) }
        setSpeedLimit(result.data.speedLimit && result.data.speedLimit !== '0' ? result.data.speedLimit : '')
      } catch { /* 读不到设置时保持默认 */ }
      const stat = await ipc.getGlobalStat().catch(() => null)
      if (stat?.success && stat.data) setGlobalStat(stat.data)
    })()
  }, [])
  const changeLanguage = useCallback((next: Language) => {
    setLanguageState(next)
    applyLanguage(next)
    void ipc.saveSettings({ language: next }).catch(() => undefined)
  }, [])
  useEffect(() => { try { return ipc.onGlobalStat((stat) => setGlobalStat(stat)) } catch { return () => undefined } }, [])
  // 点系统通知 → 跳到下载队列并展开该任务
  const [focusHash, setFocusHash] = useState<string | null>(null)
  useEffect(() => {
    try { return ipc.onFocusTask((hash) => { setViewMode('downloads'); setFocusHash(hash) }) } catch { return () => undefined }
  }, [])
  // 剪贴板检测到链接（C4）：只提示，用户确认后才添加
  const [clipboardInput, setClipboardInput] = useState<string | null>(null)
  useEffect(() => { try { return ipc.onClipboardInput((input) => setClipboardInput(input)) } catch { return () => undefined } }, [])
  // 原生菜单跳转（macOS 菜单栏「设置…」/「显示主窗口」）：只认已知视图，其余忽略
  useEffect(() => {
    try {
      return ipc.onNavigate((view) => {
        if (navItems.some((item) => item.key === view)) setViewMode(view as ViewMode)
      })
    } catch { return () => undefined }
  }, [])
  // 全局限速：只提交这一个字段，主进程会热应用到 aria2（空值 = 不限速）
  const applySpeedLimit = async (value: string) => {
    setLimitOpen(false)
    const next = value.trim() || '0'
    try {
      const result = await ipc.saveSettings({ speedLimit: next })
      if (!result.success) { setLoadError(result.error || t('app.limitFailed')); return }
      setSpeedLimit(next === '0' ? '' : next)
    } catch (error) { setLoadError(error instanceof Error ? error.message : t('app.limitFailed')) }
  }
  useEffect(() => { void (async () => { try { const result = await ipc.getSettings(); if (result.success && result.data?.theme) setThemeMode(result.data.theme) } catch { /* 读不到设置时保持跟随系统 */ } })() }, [])
  useEffect(() => { applyTheme(themeMode); return watchSystemTheme(themeMode) }, [themeMode])
  const changeTheme = (mode: ThemeMode) => { setThemeMode(mode); void ipc.saveSettings({ theme: mode }).catch(() => undefined) }
  // 状态无变化时保持原数组身份，避免每 10 秒轮询触发整树重渲染
  const refreshStatuses = useCallback(async () => {
    try {
      const next = await ipc.getAllStatuses()
      setLoadError(null)
      setTorrents((current) => JSON.stringify(current) === JSON.stringify(next) ? current : sortStatuses(next))
    } catch (error) { setLoadError(error instanceof Error ? error.message : t('app.offline')) } finally { setLoading(false) }
  }, [])
  useEffect(() => { let unsubscribe: () => void = () => undefined; try { unsubscribe = ipc.onStatusUpdate((status) => setTorrents((current) => { const next = sortStatuses([...current.filter((item) => item.infoHash !== status.infoHash), status]); return JSON.stringify(current) === JSON.stringify(next) ? current : next })); void refreshStatuses() } catch (error) { setLoadError(error instanceof Error ? error.message : '应用初始化失败'); setLoading(false) }; const timer = window.setInterval(() => void refreshStatuses(), 10000); return () => { unsubscribe(); window.clearInterval(timer) } }, [refreshStatuses])
  const selectedTorrent = useMemo(() => torrents.find((torrent) => torrent.infoHash === selectedHash) ?? null, [selectedHash, torrents])
  // 可挂载到播放器的字幕：Chromium 原生只渲染 VTT（srt 由主进程转换），ass/ssa/sub 暂不支持
  const attachableSubtitles = useMemo(() => selectedTorrent?.files.filter((file) => file.type === 'subtitle' && /\.(srt|vtt)$/i.test(file.name)) ?? [], [selectedTorrent])
  // 外部输入（C1）：双击 .torrent / 点磁力链接 / 二次启动命令行 → 直接进入解析或下载流程
  useEffect(() => {
    try {
      return ipc.onOpenInput((input) => {
        void (async () => {
          try {
            const result = await ipc.addTask(input)
            if (!result.success || !result.data) { setLoadError(result.error || t('app.openInputFailed')); return }
            if ((result.data.type || 'bt') === 'bt') { setParsingHash(result.data.infoHash); setViewMode('home') }
            else { await refreshStatuses(); setViewMode('downloads') }
          } catch (error) { setLoadError(error instanceof Error ? error.message : t('app.openInputFailed')) }
        })()
      })
    } catch { return () => undefined }
  }, [refreshStatuses])
  // 剪贴板提示的确认/忽略（C4）：放在 refreshStatuses 之后，避免回调里引用尚未声明的函数
  const acceptClipboardInput = useCallback(async () => {
    const input = clipboardInput
    setClipboardInput(null)
    if (!input) return
    try {
      const result = await ipc.addTask(input)
      if (!result.success || !result.data) { setLoadError(result.error || t('app.clipboardFailed')); return }
      if ((result.data.type || 'bt') === 'bt') { setParsingHash(result.data.infoHash); setViewMode('home') }
      else { await refreshStatuses(); setViewMode('downloads') }
    } catch (error) { setLoadError(error instanceof Error ? error.message : t('app.clipboardFailed')) }
  }, [clipboardInput, refreshStatuses])
  const dismissClipboardInput = useCallback(() => {
    // 记到主进程的忽略表里，之后不再提示同一条链接
    if (clipboardInput) void ipc.ignoreClipboardInput(clipboardInput).catch(() => undefined)
    setClipboardInput(null)
  }, [clipboardInput])
  // 播放列表（B4）：同一部剧的可播文件跨任务聚合，按季/集排序；识别不出季集时退化为当前任务内自然排序
  const playlist = useMemo(() => buildPlaylist(torrents, selectedTorrent && playingFile ? { infoHash: selectedTorrent.infoHash, file: playingFile, torrentName: selectedTorrent.name } : null), [torrents, selectedTorrent, playingFile])
  const activeCount = torrents.filter((torrent) => torrent.status === 'downloading' || torrent.status === 'connecting').length
  // 解析中任务的实时状态：从全局任务列表派生（onStatusUpdate 推送与轮询都汇入 torrents）
  const parsingTask = useMemo(() => parsingHash ? torrents.find((torrent) => torrent.infoHash === parsingHash) ?? null : null, [parsingHash, torrents])
  // 供稳定回调读取最新任务：回调身份不变，配合子组件 memo 跳过无变化的重渲染
  const selectedTorrentRef = useRef(selectedTorrent); selectedTorrentRef.current = selectedTorrent
  const torrentsRef = useRef(torrents); torrentsRef.current = torrents
  const selectTorrent = useCallback((torrent: TorrentStatus) => { setSelectedHash(torrent.infoHash); setViewMode('files') }, [])
  const added = useCallback((status?: TorrentStatus) => { if (status) setSelectedHash(status.infoHash); void refreshStatuses(); setViewMode(status ? 'files' : 'downloads') }, [refreshStatuses])
  const startPlay = useCallback(async (status: TorrentStatus, file: TorrentFileInfo) => {
    setSelectedHash(status.infoHash)
    setPlayingFile(file)
    setViewMode('player')
    const result = await ipc.downloadTorrent(status.infoHash, [file.path])
    if (!result.success) setLoadError(result.error || t('app.mediaStartFailed'))
  }, [])
  const playParsedFile = useCallback((status: TorrentStatus, file: TorrentFileInfo) => void startPlay(status, file), [startPlay])
  // 播放器内切换（上一集/下一集/连播）：同任务文件间切换，保持任务选中状态
  const switchPlayFile = useCallback(async (file: TorrentFileInfo) => {
    const current = selectedTorrentRef.current
    if (!current) return
    setPlayingFile(file)
    const result = await ipc.downloadTorrent(current.infoHash, [file.path])
    if (!result.success) setLoadError(result.error || t('app.mediaStartFailed'))
  }, [])
  // 播放列表切换（B4）：同一任务内只切文件，跨任务则连任务一起切过去
  const playEntry = useCallback(async (entry: PlaylistEntry) => {
    if (entry.infoHash === selectedTorrentRef.current?.infoHash) return switchPlayFile(entry.file)
    const target = torrentsRef.current.find((torrent) => torrent.infoHash === entry.infoHash)
    if (!target) { setLoadError(t('app.seriesMissing')); return }
    await startPlay(target, entry.file)
  }, [startPlay, switchPlayFile])
  const removeTorrent = useCallback(async (torrent: TorrentStatus, destroy: boolean) => {
    const result = await ipc.removeTorrent(torrent.infoHash, destroy)
    if (!result.success) { setLoadError(result.error || t('app.deleteFailed')); return }
    if (selectedHash === torrent.infoHash) { setSelectedHash(null); setPlayingFile(null) }
    await refreshStatuses()
  }, [selectedHash, refreshStatuses])
  const downloadParsedTask = useCallback(async (status: TorrentStatus, filePaths?: string[]) => { const result = await ipc.downloadTorrent(status.infoHash, filePaths); if (!result.success) { setLoadError(result.error || '开始下载失败'); return }; await refreshStatuses(); setViewMode('downloads') }, [refreshStatuses])
  const content = <ErrorBoundary>{loading ? <div className="page-center"><div className="loading-spinner" /><span>{t('shell.connecting')}</span></div> : viewMode === 'home' ? <Home parsingTask={parsingTask} onParsingChange={setParsingHash} onTorrentAdded={added} onPlayFile={playParsedFile} onDownload={(status, filePaths) => void downloadParsedTask(status, filePaths)} onQuickDownload={() => { void refreshStatuses(); setViewMode('downloads') }} /> : viewMode === 'downloads' ? <DownloadManager torrents={torrents} onRefresh={refreshStatuses} onSelect={selectTorrent} focusHash={focusHash} onFocusHandled={() => setFocusHash(null)} /> : viewMode === 'feeds' ? <Feeds /> : viewMode === 'settings' ? <Settings theme={themeMode} onThemeChange={changeTheme} language={language} onLanguageChange={changeLanguage} /> : viewMode === 'player' && selectedTorrent && playingFile ? <Suspense fallback={<div className="page-center"><div className="loading-spinner" /><span>{t('shell.loadingPlayer')}</span></div>}><Player infoHash={selectedTorrent.infoHash} file={playingFile} subtitles={attachableSubtitles} playlist={playlist} onSelectFile={(entry) => void playEntry(entry)} onBack={() => { setPlayingFile(null); setViewMode('files') }} /></Suspense> : <FileList torrent={selectedTorrent} torrents={torrents} onSelectTorrent={selectTorrent} onPlayFile={(file) => { if (selectedTorrent) void startPlay(selectedTorrent, file) }} onResumeTorrent={(item, file) => void startPlay(item, file)} onRemove={(torrent, destroy) => void removeTorrent(torrent, destroy)} onBack={() => setSelectedHash(null)} />}</ErrorBoundary>
  return <div className="app-shell"><aside className={`app-sidebar ${collapsed ? 'is-collapsed' : ''}`}><button className="brand" onClick={toggleCollapsed} title={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')} aria-label={collapsed ? t('shell.expandSidebar') : t('shell.collapseSidebar')} aria-expanded={!collapsed}><svg className="brand-mark" viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="brand-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e1f17"/><stop offset="1" stopColor="#0f0f09"/></linearGradient><linearGradient id="brand-lime" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#eaff93"/><stop offset="1" stopColor="#c3e040"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#brand-bg)"/><rect x="151" y="151" width="210" height="210" rx="34" transform="rotate(45 256 256)" fill="url(#brand-lime)"/><path d="M 219 190 L 343 256 L 219 322 Z" fill="#131309"/></svg><span className="brand-name">BT<span>Viewer</span></span><span className="brand-toggle" aria-hidden="true">‹</span></button><nav className="main-nav">{navItems.map((item) => <button key={item.key} className={`nav-item ${(viewMode === item.key || (viewMode === 'player' && item.key === 'files')) ? 'is-active' : ''}`} onClick={() => setViewMode(item.key)}><span className="nav-icon">{item.icon}</span><span className="nav-label">{t(item.labelKey)}</span>{item.key === 'downloads' && activeCount > 0 && <b className="nav-count">{activeCount}</b>}</button>)}</nav><div className="sidebar-bottom"><span className="online-dot" />{!collapsed && (globalStat && (globalStat.downloadSpeed > 0 || globalStat.uploadSpeed > 0) ? <span className="global-speed"><b>↓</b>{formatSpeed(globalStat.downloadSpeed)}<b>↑</b>{formatSpeed(globalStat.uploadSpeed)}</span> : <span>{t('shell.online')}</span>)}<button className={`limit-trigger ${speedLimit ? 'is-on' : ''}`} onClick={() => setLimitOpen((value) => !value)} title={t('shell.limitTitle')}>{speedLimit ? `${t('shell.limit')} ${speedLimit}` : t('shell.limit')}</button>{limitOpen && <div className="limit-popover"><div className="limit-popover-head">{t('shell.limitTitle')}<span>{speedLimit ? t('shell.limitCurrent', { value: speedLimit }) : t('shell.limitNone')}</span></div><div className="limit-presets">{[['', t('shell.limitOff')], ['1M', '1M'], ['3M', '3M'], ['5M', '5M'], ['10M', '10M']].map(([value, label]) => <button key={value || 'off'} className={speedLimit === value ? 'is-active' : ''} onClick={() => void applySpeedLimit(value)}>{label}</button>)}</div><small>{t('shell.limitHint')}</small></div>}</div></aside><main className="app-main"><header className="topbar"><div className="window-drag" /><div className="topbar-right"><button className="refresh-button no-drag" onClick={() => void refreshStatuses()}><span>↻</span> {t('shell.refresh')}</button><div className="window-controls no-drag"><button onClick={() => void ipc.minimizeWindow()} aria-label={t('shell.minimize')}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" /></svg></button><button onClick={() => void ipc.toggleMaximizeWindow()} aria-label={t('shell.maximize')}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg></button><button className="close-control" onClick={() => void ipc.closeWindow()} aria-label={t('shell.close')}><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" /></svg></button></div></div></header>{loadError && <div className="error-banner"><span>!</span>{loadError}<button onClick={() => setLoadError(null)}>×</button></div>}{clipboardInput && <div className="clipboard-banner"><span>⎘</span><span className="clipboard-text" title={clipboardInput}>{t('shell.clipboardDetected', { value: clipboardInput })}</span><button className="small-button" onClick={() => void acceptClipboardInput()}>{t('shell.addTask')}</button><button className="banner-dismiss" onClick={dismissClipboardInput} aria-label={t('shell.dismiss')}>×</button></div>}<section className="content-area">{content}</section></main></div>
}
export default App
