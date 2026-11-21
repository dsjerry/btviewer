import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
import { t } from '../services/i18n'
import { LOCAL_MEDIA_FILE_RE, formatSize, taskType, typeLabel, watchLabel, watchPercent } from '../services/task-meta'
import { getHeroImage } from '../services/thumbnail'
import FileList from './FileList'
import { VideoThumb, playableFile, placeholderIcon } from './library-bits'
import type { LocalMediaEntry, TorrentFileInfo, TorrentStatus, WatchProgress } from '../types'
import { LOCAL_MEDIA_HASH } from '../types'

interface HomeProps {
  // 解析中的任务（App 级状态派生）：切页后回来不丢解析进度
  parsingTask: TorrentStatus | null
  onParsingChange: (hash: string | null) => void
  onTorrentAdded: (status?: TorrentStatus) => void
  onPlayFile: (status: TorrentStatus, file: TorrentFileInfo) => void
  // 解析完成后把选中文件加入下载队列
  onDownload: (status: TorrentStatus, filePaths?: string[]) => void
  // 直链/视频任务无需解析选择，加入队列后打开下载浮层
  onQuickDownload: () => void
  // 拖入媒体文件（PotPlayer 式）：不经任务流程直接进播放器
  onDropMedia: (paths: string[]) => void
  // ── 影院首页嵌入的媒体库（FileList 透传）──
  torrents: TorrentStatus[]
  selectedTorrent: TorrentStatus | null
  localLibrary: LocalMediaEntry[]
  onSelectTorrent: (torrent: TorrentStatus) => void
  // 媒体库没有选中任务，续播需要显式带上任务
  onResumeTorrent: (torrent: TorrentStatus, file: TorrentFileInfo) => void
  // 详情页内按文件播放
  onDetailFilePlay: (file: TorrentFileInfo) => void
  onRemove: (torrent: TorrentStatus, destroy: boolean) => void
  // 详情页「返回媒体库」：清除选中任务
  onCloseDetail: () => void
  onImportLocal: () => void
  onPlayLocalFile: (entry: LocalMediaEntry) => void
  onRemoveLocal: (entry: LocalMediaEntry, deleteFile?: boolean) => void
  onRefreshLocal: () => void
}

const typeIcons: Record<TorrentFileInfo['type'], string> = { video: '▶', audio: '♫', subtitle: 'A', other: '•' }

// 可识别的任务输入：磁力、http(s)/ftp 链接、本地 .torrent/.metalink 文件路径
const TASK_INPUT_RE = /^(magnet:\?|https?:\/\/|ftp:\/\/)/i
const isTaskInput = (value: string) => TASK_INPUT_RE.test(value.trim()) || /\.(torrent|metalink|meta4)$/i.test(value.trim())

function size(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

// hero 大图：960px 截帧或内嵌封面（getHeroImage 自带内存/持久缓存）；加载中或失败时仅保留渐变底
const HeroBackdrop: React.FC<{ infoHash: string; filePath?: string }> = ({ infoHash, filePath }) => {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!filePath) return
    let active = true
    void getHeroImage(infoHash, filePath).then((result) => { if (active) setSrc(result) })
    return () => { active = false }
  }, [infoHash, filePath])
  if (!src) return null
  return <img className="hero-backdrop" src={src} alt="" />
}

// 影院行的轻量海报卡：无勾选/拖拽/右键（完整管理在下方媒体库），交互与库卡片一致：单击打开、悬停 ▶ 播放
interface PosterTileProps { infoHash: string; file?: TorrentFileInfo; fallback: string; title: string; progress: number; meta: string; isLocal?: boolean; missing?: boolean; onOpen: () => void; onPlay: (() => void) | null }
const PosterTile: React.FC<PosterTileProps> = ({ infoHash, file, fallback, title, progress, meta, isLocal, missing, onOpen, onPlay }) => (
  <div className={`torrent-tile ${isLocal ? 'local-tile' : ''} ${missing ? 'is-missing' : ''}`} onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); onOpen() } }}>
    <div className="tile-poster">
      <VideoThumb infoHash={infoHash} file={file} className="tile-icon" fallback={fallback} />
      <span className="tile-scrim" aria-hidden="true" />
      {progress > 0 && <div className="tile-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>}
      {onPlay && <button type="button" className="tile-play" title={`${t('library.play')}「${title}」`} aria-label={`${t('library.play')}「${title}」`} onClick={(event) => { event.stopPropagation(); onPlay() }}>▶</button>}
    </div>
    <div className="tile-body">
      <strong title={title}>{title}</strong>
      <small>{meta}</small>
    </div>
  </div>
)

const Home: React.FC<HomeProps> = ({ parsingTask, onParsingChange, onTorrentAdded, onPlayFile, onDownload, onQuickDownload, onDropMedia, torrents, selectedTorrent, localLibrary, onSelectTorrent, onResumeTorrent, onDetailFilePlay, onRemove, onCloseDetail, onImportLocal, onPlayLocalFile, onRemoveLocal, onRefreshLocal }) => {
  const [magnetUri, setMagnetUri] = useState('')
  // 添加任务弹层：影院首页把 add-panel 收进弹层，工具栏按钮唤起
  const [addOpen, setAddOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  // 勾选状态按任务初始化：文件列表首次到达时默认勾选全部媒体与字幕
  const selectionRef = useRef<{ hash: string; initialized: boolean }>({ hash: '', initialized: false })
  // 等待元数据的时长：用于把「正在获取」逐步升级为「较慢，建议多等一会儿」而不是突然报错
  const [waitedSeconds, setWaitedSeconds] = useState(0)
  // 只在「解析中且还没有文件列表」时走秒表；依赖取原始值避免每次状态推送都重建定时器
  const parsingHash = parsingTask?.infoHash ?? ''
  const parsingFileCount = parsingTask?.files.length ?? 0
  useEffect(() => {
    setWaitedSeconds(0)
    if (!parsingHash || parsingFileCount > 0) return
    const timer = window.setInterval(() => setWaitedSeconds((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [parsingHash, parsingFileCount])
  const waitHint = !parsingTask
    ? ''
    : waitedSeconds < 10
      ? t('home.waitingMetaHint')
      : waitedSeconds < 45
        ? t('home.waitingMetaSlow', { seconds: Math.floor(waitedSeconds / 10) * 10 })
        : t('home.waitingMetaLong', { seconds: waitedSeconds })

  useEffect(() => {
    if (!parsingTask || !parsingTask.files.length) return
    if (selectionRef.current.hash === parsingTask.infoHash && selectionRef.current.initialized) return
    selectionRef.current = { hash: parsingTask.infoHash, initialized: true }
    setSelectedFiles(new Set(parsingTask.files.filter((file) => file.type !== 'other').map((file) => file.path)))
  }, [parsingTask])

  // 统一任务入口：BT 任务进入解析流程（三选一），直链/视频任务直接入队并打开下载浮层
  const parseInput = async (value: string) => {
    const text = value.trim()
    if (!isTaskInput(text)) { setNotice({ type: 'error', text: t('home.batchFailedHint') }); return }
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTask(text)
      if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || '添加任务失败' }); return }
      if ((result.data.type || 'bt') === 'bt') {
        setMagnetUri(''); onParsingChange(result.data.infoHash); setNotice(null)
      } else {
        setMagnetUri('')
        onQuickDownload()
      }
      setAddOpen(false)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '添加任务失败' }) } finally { setLoading(false) }
  }

  // 批量入口：一次粘贴多个链接（每行一个）时不再逐个进解析流程。
  // BT 任务只登记到媒体库（不自动开始下载，等用户选文件），直链/视频任务直接开始下载。
  const addBatch = async (links: string[]) => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTasksBatch(links)
      if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || '批量添加失败' }); return }
      const { added, bt, failed, errors } = result.data
      const direct = added - bt
      setMagnetUri('')
      const parts = [t('home.batchAdded', { added })]
      if (bt) parts.push(t('home.batchBt', { count: bt }))
      if (direct) parts.push(t('home.batchDirect', { count: direct }))
      if (failed) parts.push(t('home.batchFailed', { count: failed }))
      setNotice({ type: failed ? 'error' : 'success', text: `${parts.join('，')}${errors.length ? `：${errors[0]}` : ''}` })
      setAddOpen(false)
      if (direct) onQuickDownload()
      else onTorrentAdded()
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '批量添加失败' }) } finally { setLoading(false) }
  }

  const addTask = () => {
    const links = magnetUri.split(/\s+/).map((item) => item.trim()).filter(isTaskInput)
    if (links.length > 1) { void addBatch(links); return }
    void parseInput(magnetUri)
  }

  const parseTaskFile = async (path: string) => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTask(path)
      if (result.success && result.data) {
        setAddOpen(false)
        if ((result.data.type || 'bt') === 'bt') onParsingChange(result.data.infoHash)
        else onQuickDownload()
      } else setNotice({ type: 'error', text: result.error || '解析文件失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '解析文件失败' }) } finally { setLoading(false) }
  }

  // 剪贴板解析：读到磁力/直链后自动填入并添加
  const pasteInput = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!isTaskInput(text)) { setNotice({ type: 'error', text: t('home.clipboardEmpty') }); return }
      setMagnetUri(text)
      await parseInput(text)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('home.clipboardFailed') }) }
  }

  const openFile = async () => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.openFile()
      if (result.success && result.data) {
        setAddOpen(false)
        if ((result.data.type || 'bt') === 'bt') onParsingChange(result.data.infoHash)
        else onQuickDownload()
      } else if (!result.canceled) setNotice({ type: 'error', text: result.error || '解析文件失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '打开文件失败' }) } finally { setLoading(false) }
  }

  const toggleFile = (path: string) => setSelectedFiles((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })

  const resetParse = () => {
    onParsingChange(null)
    selectionRef.current = { hash: '', initialized: false }
    setSelectedFiles(new Set())
  }

  // 拖放解析：优先批量处理所有 .torrent/.metalink 文件与文本中的全部链接；
  // 拖入的是视频/音频文件时改为直接进播放器（PotPlayer 式），不进任务流程
  const dropFiles = async (event: React.DragEvent) => {
    const transfer = event.dataTransfer
    const mediaPaths = Array.from(transfer.files).filter((item) => LOCAL_MEDIA_FILE_RE.test(item.name)).map((item) => ipc.getPathForFile(item))
    if (mediaPaths.length) { event.preventDefault(); onDropMedia(mediaPaths); return }
    const taskFiles = Array.from(transfer.files).filter((item) => /\.(torrent|metalink|meta4)$/i.test(item.name)).map((item) => ipc.getPathForFile(item))
    const text = transfer.getData('text/uri-list') || transfer.getData('text/plain')
    const links = text.split(/\s+/).map((item) => item.trim()).filter(isTaskInput)
    const all = [...taskFiles, ...links]
    if (!all.length) { setNotice({ type: 'error', text: t('home.dropFilesOnly') }); return }
    // 单个 BT 文件仍走解析流程（可以选择要下载的文件）；其余情况批量入队
    if (all.length === 1 && taskFiles.length === 1) { await parseTaskFile(all[0]); return }
    await addBatch(all)
  }

  // 用计数器处理嵌套元素的 dragenter/dragleave，避免子元素误触发遮罩闪烁
  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => { event.preventDefault(); dragDepth.current += 1; setDragging(true) },
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void dropFiles(event) }
  }

  // 添加弹层：Esc 关闭（解析视图接管整页时弹层已卸载）
  useEffect(() => {
    if (!addOpen || parsingTask) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setAddOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [addOpen, parsingTask])

  // ── 影院首页数据：观看进度扇出（progress-store 主进程侧有内存缓存，开销极小）──
  const [watchMap, setWatchMap] = useState<Record<string, WatchProgress | null>>({})
  const torrentsRef = useRef(torrents); torrentsRef.current = torrents
  // 依赖键只随「任务或主文件」变化，避免每秒状态刷新都重新拉取进度
  const watchKey = useMemo(() => torrents.map((item) => `${item.infoHash}:${playableFile(item)?.path || ''}`).join('|'), [torrents])
  useEffect(() => {
    let active = true
    void (async () => {
      const entries = await Promise.all(torrentsRef.current.map(async (item) => {
        const file = playableFile(item)
        if (!file) return [item.infoHash, null] as const
        try { return [item.infoHash, await ipc.getProgress(item.infoHash, file.path)] as const } catch { return [item.infoHash, null] as const }
      }))
      if (active) setWatchMap(Object.fromEntries(entries))
    })()
    return () => { active = false }
  }, [watchKey])

  const [localWatchMap, setLocalWatchMap] = useState<Record<string, WatchProgress | null>>({})
  const localWatchKey = useMemo(() => localLibrary.map((entry) => entry.path).join('|'), [localLibrary])
  useEffect(() => {
    let active = true
    void (async () => {
      const entries = await Promise.all(localLibrary.map(async (entry) => {
        try { return [entry.path, await ipc.getProgress(LOCAL_MEDIA_HASH, entry.path)] as const } catch { return [entry.path, null] as const }
      }))
      if (active) setLocalWatchMap(Object.fromEntries(entries))
    })()
    return () => { active = false }
  }, [localWatchKey, localLibrary])

  // 继续观看：看过但没看完的任务与本地视频合并，按最近观看时间排序
  type ResumeCard = { key: string; name: string; watch: WatchProgress | null; infoHash: string; filePath: string; fallback: string; resume: () => void; detail: (() => void) | null }
  const resumeCards: ResumeCard[] = []
  for (const item of torrents) {
    const watch = watchMap[item.infoHash]
    const file = playableFile(item)
    const percent = watchPercent(watch)
    if (percent > 0 && percent < 95 && file) resumeCards.push({ key: item.infoHash, name: item.name, watch, infoHash: item.infoHash, filePath: file.path, fallback: placeholderIcon(item), resume: () => onResumeTorrent(item, file), detail: () => onSelectTorrent(item) })
  }
  for (const entry of localLibrary) {
    const watch = localWatchMap[entry.path]
    const percent = watchPercent(watch)
    if (percent > 0 && percent < 95 && !entry.missing) resumeCards.push({ key: entry.path, name: entry.name, watch, infoHash: LOCAL_MEDIA_HASH, filePath: entry.path, fallback: entry.type === 'audio' ? '♫' : '▶', resume: () => onPlayLocalFile(entry), detail: null })
  }
  resumeCards.sort((a, b) => (b.watch?.updatedAt || 0) - (a.watch?.updatedAt || 0))

  // 最近添加：任务 + 本地引用按加入时间合并（海报行 + hero 兜底）
  type RecentItem = { key: string; name: string; infoHash: string; filePath?: string; fallback: string; progress: number; meta: string; isLocal?: boolean; missing?: boolean; addedAt: number; open: () => void; play: (() => void) | null; detail: (() => void) | null }
  const recentItems: RecentItem[] = []
  for (const item of torrents) {
    const file = playableFile(item)
    recentItems.push({
      key: `task-${item.infoHash}`,
      name: item.name,
      infoHash: item.infoHash,
      filePath: file?.path,
      fallback: placeholderIcon(item),
      progress: watchPercent(watchMap[item.infoHash]),
      meta: `${typeLabel(taskType(item))} · ${formatSize(item.totalSize)}`,
      addedAt: item.addedAt || 0,
      open: () => onSelectTorrent(item),
      play: file ? () => onResumeTorrent(item, file) : null,
      detail: () => onSelectTorrent(item)
    })
  }
  for (const entry of localLibrary) {
    recentItems.push({
      key: `local-${entry.path}`,
      name: entry.name,
      infoHash: LOCAL_MEDIA_HASH,
      filePath: entry.path,
      fallback: entry.type === 'audio' ? '♫' : '▶',
      progress: watchPercent(localWatchMap[entry.path]),
      meta: formatSize(entry.size),
      isLocal: true,
      missing: entry.missing,
      addedAt: entry.addedAt,
      open: () => { if (!entry.missing) onPlayLocalFile(entry) },
      play: entry.missing ? null : () => onPlayLocalFile(entry),
      detail: null
    })
  }
  recentItems.sort((a, b) => b.addedAt - a.addedAt)
  const recent = recentItems.slice(0, 12)

  if (parsingTask) {
    const playable = parsingTask.files.filter((file) => file.type === 'video' || file.type === 'audio')
    const finishParsing = (action: () => void) => { onParsingChange(null); selectionRef.current = { hash: '', initialized: false }; action() }
    return (
      <div className="home-page" {...dragHandlers}>
        {dragging && <div className="drop-overlay"><strong>{t('home.dropTitle')}</strong><small>{t('home.dropHint')}</small></div>}
        <div className="result-panel">
          <button className="back-link" onClick={resetParse}>{t('home.reselect')}</button>
          <div className="result-heading">
            <span className="panel-icon">✓</span>
            <div>
              <span className="eyebrow">{t('home.parsed')}</span>
              <h2>{parsingTask.name}</h2>
              <p>{parsingTask.files.length ? t('home.parsedDesc', { files: parsingTask.files.length, size: size(parsingTask.totalSize) }) : t('home.waitingMeta')}</p>
            </div>
          </div>
          {parsingTask.files.length ? (
            <>
              <div className="result-file-tools">
                <span>{t('home.selected', { selected: selectedFiles.size, total: parsingTask.files.length })}</span>
                <button onClick={() => setSelectedFiles(new Set(parsingTask.files.map((file) => file.path)))}>{t('home.selectAll')}</button>
                <button onClick={() => setSelectedFiles(new Set())}>{t('home.clear')}</button>
                <small>{t('home.onlySelected')}</small>
              </div>
              <div className="result-file-list">
                {parsingTask.files.map((file) => (
                  <label className="result-file" key={file.path}>
                    <input type="checkbox" checked={selectedFiles.has(file.path)} onChange={() => toggleFile(file.path)} />
                    <span className={`file-icon ${file.type}`}>{typeIcons[file.type]}</span>
                    <span title={file.name}>{file.name}</span>
                    <small>{size(file.size)}</small>
                  </label>
                ))}
              </div>
              <div className="result-actions">
                <button className="save-action" onClick={() => finishParsing(() => onTorrentAdded(parsingTask))}>{t('home.saveToLibrary')} <span>＋</span></button>
                {playable.length > 0 && <button className="play-action" onClick={() => finishParsing(() => onPlayFile(parsingTask, playable[0]))}>{t('home.playFirst', { which: playable.length > 1 ? t('home.playFirstMedia') : '' })} <span>▶</span></button>}
                {playable.length === 0 && <span />}
                <button className="download-action" disabled={!selectedFiles.size} onClick={() => finishParsing(() => onDownload(parsingTask, [...selectedFiles]))}>{selectedFiles.size === parsingTask.files.length ? t('home.downloadAll') : t('home.downloadSelected', { count: selectedFiles.size })} <span>↓</span></button>
              </div>
            </>
          ) : parsingTask.status === 'error' ? (
            <div className="waiting-result">
              <span>{t('home.parseError', { error: parsingTask.error || t('home.parseFailed') })}</span>
              <small>{t('home.parseErrorHint')}</small>
            </div>
          ) : (
            <div className="waiting-result">
              <div className="loading-spinner" />
              <span>{t('home.waitingMeta')}</span>
              <small>{waitHint}</small>
              {waitedSeconds >= 45 && (
                <small className="waiting-result-advice">{t('home.waitingMetaStalled')}</small>
              )}
            </div>
          )}
          <p className="privacy-note"><span>◉</span> {t('home.pendingNote')}</p>
        </div>
      </div>
    )
  }

  // hero：继续观看优先，无则用最近添加，库为空时欢迎态
  const heroCard = resumeCards[0]
  const heroRecent = !heroCard ? recent[0] : null

  return (
    <div className="home-page" {...dragHandlers}>
      {dragging && <div className="drop-overlay"><strong>{t('home.dropTitle')}</strong><small>{t('home.dropHint')}</small></div>}
      {!selectedTorrent && (
        <div className="home-cinema">
          <div className="home-toolbar">
            <strong>{t('library.title')}</strong>
            <button className="primary-action" onClick={() => { setNotice(null); setAddOpen(true) }}><span>＋</span>{t('home.add')}</button>
          </div>
          {/* 弹层关闭后仍要展示的添加结果提示（如批量 BT 入队成功） */}
          {!addOpen && notice && <div className={`inline-notice home-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
          {heroCard ? (
            <section className="home-hero">
              <HeroBackdrop infoHash={heroCard.infoHash} filePath={heroCard.filePath} />
              <div className="hero-scrim" aria-hidden="true" />
              <div className="hero-info">
                <span className="hero-eyebrow">{t('library.continue')}</span>
                <h2 title={heroCard.name}>{heroCard.name}</h2>
                <div className="hero-progress"><span className="bar"><span style={{ width: `${watchPercent(heroCard.watch)}%` }} /></span><small>{watchPercent(heroCard.watch)}%</small></div>
                <div className="hero-actions">
                  <button className="primary-action" onClick={heroCard.resume}>▶ {t('library.play')}</button>
                  {heroCard.detail && <button className="secondary-action" onClick={heroCard.detail}>{t('home.viewDetail')}</button>}
                </div>
              </div>
            </section>
          ) : heroRecent ? (
            <section className="home-hero">
              <HeroBackdrop infoHash={heroRecent.infoHash} filePath={heroRecent.filePath} />
              <div className="hero-scrim" aria-hidden="true" />
              <div className="hero-info">
                <span className="hero-eyebrow">{t('library.sortAdded')}</span>
                <h2 title={heroRecent.name}>{heroRecent.name}</h2>
                <div className="hero-actions">
                  <button className="primary-action" onClick={heroRecent.play ?? heroRecent.open}>▶ {t('library.play')}</button>
                  {heroRecent.detail && <button className="secondary-action" onClick={heroRecent.detail}>{t('home.viewDetail')}</button>}
                </div>
              </div>
            </section>
          ) : (
            <section className="home-hero is-empty">
              <div className="hero-scrim" aria-hidden="true" />
              <div className="hero-info">
                <span className="hero-eyebrow">{t('library.title')}</span>
                <h2>{t('home.title')}</h2>
                <p>{t('home.subtitle')}</p>
                <div className="hero-actions">
                  <button className="primary-action" onClick={() => { setNotice(null); setAddOpen(true) }}><span>＋</span>{t('home.add')}</button>
                </div>
              </div>
            </section>
          )}
          {resumeCards.length > 1 && (
            <div className="media-row">
              <div className="media-row-head"><span>{t('library.continue')}</span><small>{t('library.continueHint')}</small></div>
              <div className="media-row-list">
                {resumeCards.slice(1).map((card) => (
                  <button className="resume-card" key={card.key} onClick={card.resume} title={`${t('library.play')}「${card.name}」`}>
                    <VideoThumb infoHash={card.infoHash} file={{ path: card.filePath } as TorrentFileInfo} className="resume-thumb" fallback={card.fallback} />
                    <span className="resume-name">{card.name}</span>
                    <span className="resume-progress"><span style={{ width: `${watchPercent(card.watch)}%` }} /></span>
                    <small>{watchLabel(card.watch)}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {recent.length > 0 && (
            <div className="media-row">
              <div className="media-row-head"><span>{t('library.sortAdded')}</span></div>
              <div className="media-row-list">
                {recent.map((item) => (
                  <PosterTile
                    key={item.key}
                    infoHash={item.infoHash}
                    file={item.filePath ? { path: item.filePath } as TorrentFileInfo : undefined}
                    fallback={item.fallback}
                    title={item.name}
                    progress={item.progress}
                    meta={item.meta}
                    isLocal={item.isLocal}
                    missing={item.missing}
                    onOpen={item.open}
                    onPlay={item.play}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <FileList
        torrent={selectedTorrent}
        torrents={torrents}
        onSelectTorrent={onSelectTorrent}
        onPlayFile={onDetailFilePlay}
        onResumeTorrent={onResumeTorrent}
        onRemove={onRemove}
        onBack={onCloseDetail}
        localLibrary={localLibrary}
        onImportLocal={onImportLocal}
        onPlayLocalFile={onPlayLocalFile}
        onRemoveLocal={onRemoveLocal}
        onRefreshLocal={onRefreshLocal}
        hideResumeStrip
        hideHeading={!selectedTorrent}
      />
      {addOpen && (
        <div className="add-overlay" onClick={(event) => { if (event.target === event.currentTarget) setAddOpen(false) }}>
          <div className="add-panel is-modal">
            <button className="add-close" onClick={() => setAddOpen(false)} aria-label={t('shell.dismiss')}>×</button>
            <div className="panel-kicker"><span className="panel-icon">+</span><div><strong>{t('home.title')}</strong><small>{t('home.subtitle')}</small></div></div>
            <label htmlFor="magnet">{t('home.inputLabel')}</label>
            <textarea id="magnet" value={magnetUri} onChange={(event) => setMagnetUri(event.target.value)} placeholder={t('home.placeholder')} rows={4} disabled={loading} autoFocus />
            <button className="primary-action" onClick={addTask} disabled={loading}>{loading ? <span className="button-loader" /> : t('home.add')}<span>→</span></button>
            <div className="or-divider"><span>{t('home.or')}</span></div>
            <div className="alt-actions">
              <button className="secondary-action" onClick={() => void pasteInput()} disabled={loading}><span>⎘</span><span className="action-label">{t('home.fromClipboard')}</span></button>
              <button className="secondary-action" onClick={() => void openFile()} disabled={loading} title={t('home.pickFile')}><span>⌁</span><span className="action-label">{t('home.pickFile')}</span></button>
            </div>
            {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
            <div className="privacy-note"><span>◉</span> {t('home.privacy')}</div>
          </div>
        </div>
      )}
    </div>
  )
}
export default Home
