import { sameTorrentFile } from '../services/torrent-diff'
import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
import { formatSize, localEntryToFile, statusLabel, taskType, typeLabel, watchLabel, watchPercent } from '../services/task-meta'
import { episodeLabel, parseEpisode, type EpisodeTag } from '../services/episode'
import { t } from '../services/i18n'
import type { LocalMediaEntry, TorrentFileInfo, TorrentStatus, WatchProgress } from '../types'
import { LOCAL_MEDIA_HASH } from '../types'
import getThumbnail from '../services/thumbnail'
interface FileListProps {
  torrent: TorrentStatus | null
  torrents: TorrentStatus[]
  onSelectTorrent: (torrent: TorrentStatus) => void
  onPlayFile: (file: TorrentFileInfo) => void
  // 媒体库列表页没有选中任务，续播需要显式带上任务
  onResumeTorrent: (torrent: TorrentStatus, file: TorrentFileInfo) => void
  onRemove: (torrent: TorrentStatus, destroy: boolean) => void
  onBack: () => void
  // 本地视频引用（媒体库一等公民）：导入/点播/移除由 App 统一处理
  localLibrary: LocalMediaEntry[]
  onImportLocal: () => void
  onPlayLocalFile: (entry: LocalMediaEntry) => void
  onRemoveLocal: (entry: LocalMediaEntry) => void
  onRefreshLocal: () => void
}
type SortKey = 'added' | 'name' | 'size' | 'watched'
type FilterKey = 'all' | 'video' | 'audio' | 'unfinished'
const SORT_OPTIONS: Array<{ value: SortKey; labelKey: string }> = [
  { value: 'added', labelKey: 'library.sortAdded' },
  { value: 'watched', labelKey: 'library.sortWatched' },
  { value: 'name', labelKey: 'library.sortName' },
  { value: 'size', labelKey: 'library.sortSize' }
]
const FILTER_OPTIONS: Array<{ value: FilterKey; labelKey: string }> = [
  { value: 'all', labelKey: 'library.filterAll' },
  { value: 'video', labelKey: 'library.filterVideo' },
  { value: 'audio', labelKey: 'library.filterAudio' },
  { value: 'unfinished', labelKey: 'library.filterUnfinished' }
]
// 文件类型文案：模块级常量会在导入时就冻结语言，所以做成函数按当前语言取值
const fileTypeLabel = (type: TorrentFileInfo['type']) => t(`library.type.${type}`)
const icons = { video: '▶', audio: '♫', subtitle: 'A', other: '•' }
const percentOf = (torrent: TorrentStatus) => Math.round(torrent.progress * 100)
// 任务的主播放文件：优先视频，其次音频（媒体库以「观看进度」为主，需定位到具体文件）
const playableFile = (torrent: TorrentStatus) => torrent.files.find((file) => file.type === 'video') || torrent.files.find((file) => file.type === 'audio')
// 无缩略图时的占位符号：音频用 ♫，其余用 ◈
const placeholderIcon = (torrent: TorrentStatus) => (playableFile(torrent)?.type === 'audio' ? '♫' : '◈')
// 媒体库不是下载列表：仅在尚未下载完成时补一句下载提示，已完成则不再显示状态
const downloadHint = (torrent: TorrentStatus) => {
  if (torrent.status === 'seeding') return ''
  return torrent.status === 'downloading' ? ` · ${t('status.downloading')} ${percentOf(torrent)}%` : ` · ${statusLabel(torrent.status)}`
}

// 视频缩略图：从媒体流截帧（服务内含持久化与失败负缓存），截不出时回退图标
const VideoThumb: React.FC<{ infoHash: string; file?: TorrentFileInfo; className: string; fallback: string }> = ({ infoHash, file, className, fallback }) => {
  const [thumb, setThumb] = useState<string | null>(null)
  const path = file?.path
  useEffect(() => {
    if (!file) return
    let active = true
    void getThumbnail(infoHash, file.path).then((result) => { if (active) setThumb(result) })
    return () => { active = false }
  }, [infoHash, path, file])
  if (!thumb) return <span className={className}>{fallback}</span>
  return <img className={`${className} has-thumb`} src={thumb} alt="" />
}

// 观看进度徽标：已看进度用强调色，未观看用弱化色
const WatchBadge: React.FC<{ watch?: WatchProgress | null }> = ({ watch }) => {
  const percent = watchPercent(watch)
  return <span className={`watch-label ${percent > 0 ? 'is-watched' : ''}`}>{watchLabel(watch)}</span>
}

// 库条目容器（媒体库网格视图共用）：任务卡片与本地视频引用只是数据与交互不同，结构完全同构。
// 差异全部通过 props 注入（缩略图、标签、点击行为、移除确认），避免两份拷贝各自演化产生不一致。
interface LibraryTileProps {
  thumb: React.ReactNode
  title: string
  tags: React.ReactNode
  progress: number
  meta: React.ReactNode
  onClick: () => void
  onRemove: () => void
  removeTitle: string
  isLocal?: boolean
  missing?: boolean
}
const LibraryTile: React.FC<LibraryTileProps> = ({ thumb, title, tags, progress, meta, onClick, onRemove, removeTitle, isLocal, missing }) => (
  <div className={`torrent-tile ${isLocal ? 'local-tile' : ''} ${missing ? 'is-missing' : ''}`} onClick={onClick} role="button" tabIndex={0}>
    <button className="tile-remove" title={removeTitle} onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
    <div className="tile-poster">
      {thumb}
      <span className="tile-scrim" aria-hidden="true" />
      <span className="tile-play" aria-hidden="true">▶</span>
    </div>
    <strong title={title}>{title}</strong>
    <div className="tile-tags">{tags}</div>
    <div className="tile-progress"><span style={{ width: `${progress}%` }} /></div>
    <small>{meta}</small>
  </div>
)

// 库条目容器（媒体库列表视图共用），与 LibraryTile 成对
interface LibraryRowProps {
  thumb: React.ReactNode
  title: string
  sub: React.ReactNode
  progress: number
  trailing?: React.ReactNode
  onClick: () => void
  onRemove: () => void
  removeTitle: string
  isLocal?: boolean
  missing?: boolean
}
const LibraryRow: React.FC<LibraryRowProps> = ({ thumb, title, sub, progress, trailing, onClick, onRemove, removeTitle, isLocal, missing }) => (
  <div className={`library-row ${isLocal ? 'local-row' : ''} ${missing ? 'is-missing' : ''}`} onClick={onClick} role="button" tabIndex={0}>
    {thumb}
    <div className="row-main">
      <strong title={title}>{title}</strong>
      <span className="row-sub">{sub}</span>
    </div>
    {trailing}
    <span className="row-progress"><span className="bar"><span style={{ width: `${progress}%` }} /></span>{progress > 0 && <small>{progress}%</small>}</span>
    <button className="tile-remove" title={removeTitle} onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
  </div>
)

interface FileRowProps { infoHash: string; file: TorrentFileInfo; onPlayFile: (file: TorrentFileInfo) => void }
// 文件行 memo：状态每秒刷新会重建 files 数组，内容相同的行直接跳过重渲染
const FileRow = memo<FileRowProps>(({ infoHash, file, onPlayFile }) => {
  const percent = file.size ? Math.min(100, Math.round((file.completed / file.size) * 100)) : 0
  const unselected = file.selected === false
  return <div className={`file-item ${unselected ? 'is-unselected' : ''}`}><div className="file-name">{unselected && <span className="file-unselected-tag">{t('library.notSelected')}</span>}{parseEpisode(file.name) && <span className="file-episode" title="识别到的季集">{episodeLabel(parseEpisode(file.name))}</span>}{file.type === 'video' ? <VideoThumb infoHash={infoHash} file={file} className="file-icon video" fallback="▶" /> : <span className={`file-icon ${file.type}`}>{icons[file.type]}</span>}<strong title={file.name}>{file.name}</strong></div><span className="file-progress"><span className="bar"><span style={{ width: `${percent}%` }} /></span><small>{percent}%</small></span><span className="file-type">{fileTypeLabel(file.type)}</span><span className="file-size">{formatSize(file.size)}</span>{file.type === 'video' || file.type === 'audio' ? <button className="play-button" onClick={() => onPlayFile(file)}>播放 <span>↗</span></button> : <span />}</div>
}, (a, b) => a.infoHash === b.infoHash && a.onPlayFile === b.onPlayFile && sameTorrentFile(a.file, b.file) && a.file.selected === b.file.selected)

const FileList: React.FC<FileListProps> = ({ torrent, torrents, onSelectTorrent, onPlayFile, onResumeTorrent, onRemove, onBack, localLibrary, onImportLocal, onPlayLocalFile, onRemoveLocal, onRefreshLocal }) => {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  // 本地引用的 missing 状态要现查（移动硬盘可能已挂载/拔出）：挂载时刷一次
  useEffect(() => { onRefreshLocal() }, [onRefreshLocal])
  // 媒体库视图：卡片网格 / 紧凑列表，偏好持久化
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('btviewer-library-view') === 'list' ? 'list' : 'grid'))
  const changeView = (mode: 'grid' | 'list') => { setView(mode); localStorage.setItem('btviewer-library-view', mode) }
  // 检索与排序：任务多了以后按名称/大小/最近添加/最近观看排序，并按类型或「未看完」筛选
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState<SortKey>(() => (SORT_OPTIONS.some((item) => item.value === localStorage.getItem('btviewer-library-sort')) ? localStorage.getItem('btviewer-library-sort') as SortKey : 'added'))
  const [filter, setFilter] = useState<FilterKey>(() => (FILTER_OPTIONS.some((item) => item.value === localStorage.getItem('btviewer-library-filter')) ? localStorage.getItem('btviewer-library-filter') as FilterKey : 'all'))
  const changeSort = (value: SortKey) => { setSort(value); localStorage.setItem('btviewer-library-sort', value) }
  const changeFilter = (value: FilterKey) => { setFilter(value); localStorage.setItem('btviewer-library-filter', value) }
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }
  // 默认只显示勾选下载的文件：种子里的其它文件（花絮、其他语言音轨等）折叠起来，避免看起来「全都下了」
  const [showAllFiles, setShowAllFiles] = useState(false)
  const selectedCount = useMemo(() => torrent?.files.filter((file) => file.selected !== false).length ?? 0, [torrent])
  const hiddenCount = (torrent?.files.length ?? 0) - selectedCount
  const files = useMemo(() => {
    const list = torrent?.files ?? []
    return list
      .filter((file) => (showAllFiles ? true : file.selected !== false))
      .filter((file) => file.name.toLowerCase().includes(query.toLowerCase()))
  }, [torrent, query, showAllFiles])

  // 观看进度：按 infoHash 汇总，用于列表页展示「看到哪」；播放器返回会重新挂载本组件，进度随之刷新
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

  // 本地视频引用的观看进度：与任务进度同一存储（键为 local-media:路径），库页据此展示「看到哪」
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

  // 库列表：网格 / 紧凑列表共用同一份数据与移除确认逻辑
  const confirmRemove = (item: TorrentStatus) => { if (window.confirm(t('library.removeConfirm', { name: item.name }))) onRemove(item, false) }
  const localSection = localLibrary.length > 0 && (
    <div className="local-library">
      <div className="library-section-head"><span>{t('library.localSection')}</span><small>{localLibrary.length}</small></div>
      {view === 'grid' ? (
        <div className="torrent-grid">
          {localLibrary.map((entry) => {
            const watch = localWatchMap[entry.path]
            return (
              <LibraryTile
                key={entry.path}
                isLocal
                missing={entry.missing}
                thumb={<VideoThumb infoHash={LOCAL_MEDIA_HASH} file={localEntryToFile(entry)} className="tile-icon" fallback={entry.type === 'audio' ? '♫' : '▶'} />}
                title={entry.name}
                tags={<><span className="task-type">{t('library.localTag')}</span>{entry.missing && <span className="task-error">{t('library.localMissing')}</span>}<WatchBadge watch={watch} /></>}
                progress={watchPercent(watch)}
                meta={<span title={entry.path}>{formatSize(entry.size)}</span>}
                onClick={() => { if (!entry.missing) onPlayLocalFile(entry) }}
                onRemove={() => onRemoveLocal(entry)}
                removeTitle={t('library.removeRecord')}
              />
            )
          })}
        </div>
      ) : (
        <div className="library-list">
          {localLibrary.map((entry) => {
            const watch = localWatchMap[entry.path]
            return (
              <LibraryRow
                key={entry.path}
                isLocal
                missing={entry.missing}
                thumb={<VideoThumb infoHash={LOCAL_MEDIA_HASH} file={localEntryToFile(entry)} className="row-icon" fallback={entry.type === 'audio' ? '♫' : '▶'} />}
                title={entry.name}
                sub={<>{t('library.localTag')} · {formatSize(entry.size)}{entry.missing ? ` · ${t('library.localMissing')}` : ''}</>}
                progress={watchPercent(watch)}
                trailing={<WatchBadge watch={watch} />}
                onClick={() => { if (!entry.missing) onPlayLocalFile(entry) }}
                onRemove={() => onRemoveLocal(entry)}
                removeTitle={t('library.removeRecord')}
              />
            )
          })}
        </div>
      )}
    </div>
  )
  const metaLine = (item: TorrentStatus) => `${typeLabel(taskType(item))} · ${t('library.fileCount', { count: item.files.length })} · ${formatSize(item.totalSize)}${downloadHint(item)}`
  // 剧集概览（B4）：能识别出 2 集以上时给一个「S01 · 12 集」，跨季则显示区间
  const episodeSummary = (item: TorrentStatus) => {
    const tags = item.files.filter((file) => file.type === 'video' || file.type === 'audio').map((file) => parseEpisode(file.name)).filter((tag): tag is EpisodeTag => !!tag)
    if (tags.length < 2) return ''
    const seasons = [...new Set(tags.map((tag) => tag.season))].sort((a, b) => a - b)
    const pad = (value: number) => String(value).padStart(2, '0')
    const range = seasons.length === 1 ? `S${pad(seasons[0])}` : `S${pad(seasons[0])}-S${pad(seasons[seasons.length - 1])}`
    return `${range} · ${tags.length} 集`
  }

  // 检索/筛选/排序：排序键含「最近添加」（addedAt）与「最近观看」（观看进度更新时间）
  const visible = useMemo(() => {
    const text = keyword.trim().toLowerCase()
    const matched = torrents.filter((item) => {
      if (text && !item.name.toLowerCase().includes(text)) return false
      if (filter === 'video') return item.files.some((file) => file.type === 'video')
      if (filter === 'audio') return !item.files.some((file) => file.type === 'video') && item.files.some((file) => file.type === 'audio')
      if (filter === 'unfinished') { const percent = watchPercent(watchMap[item.infoHash]); return percent > 0 && percent < 95 }
      return true
    })
    const sorted = [...matched]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    else if (sort === 'size') sorted.sort((a, b) => b.totalSize - a.totalSize)
    else if (sort === 'watched') sorted.sort((a, b) => (watchMap[b.infoHash]?.updatedAt || 0) - (watchMap[a.infoHash]?.updatedAt || 0))
    else sorted.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
    return sorted
  }, [torrents, keyword, filter, sort, watchMap])

  // 继续观看：看过但没看完的任务与本地视频合并，按最近观看时间排序
  type ResumeCard = { key: string; name: string; watch: WatchProgress | null; thumb: React.ReactNode; resume: () => void }
  const resumeCards = useMemo<ResumeCard[]>(() => {
    const cards: ResumeCard[] = []
    for (const item of torrents) {
      const watch = watchMap[item.infoHash]
      const file = playableFile(item)
      const percent = watchPercent(watch)
      if (percent > 0 && percent < 95 && file) {
        cards.push({ key: item.infoHash, name: item.name, watch, thumb: <VideoThumb infoHash={item.infoHash} file={file} className="resume-thumb" fallback={placeholderIcon(item)} />, resume: () => onResumeTorrent(item, file) })
      }
    }
    for (const entry of localLibrary) {
      const watch = localWatchMap[entry.path]
      const percent = watchPercent(watch)
      if (percent > 0 && percent < 95 && !entry.missing) {
        cards.push({ key: entry.path, name: entry.name, watch, thumb: <VideoThumb infoHash={LOCAL_MEDIA_HASH} file={localEntryToFile(entry)} className="resume-thumb" fallback={entry.type === 'audio' ? '♫' : '▶'} />, resume: () => onPlayLocalFile(entry) })
      }
    }
    return cards.sort((a, b) => (b.watch?.updatedAt || 0) - (a.watch?.updatedAt || 0)).slice(0, 8)
  }, [torrents, watchMap, localLibrary, localWatchMap, onResumeTorrent, onPlayLocalFile])

  if (!torrent) {
    return (
      <div className="page-content">
        <div className="page-heading">
          <div><span className="eyebrow">{t('library.eyebrow')}</span><h2>{t('library.title')}</h2><p>{t('library.subtitle')}</p></div>
          <div className="heading-side">
            <button className="small-button library-import" onClick={onImportLocal}>
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2.75" y="4.75" width="10.5" height="10.5" rx="2" />
                <path d="M6.5 7.75L10.25 10L6.5 12.25Z" fill="currentColor" stroke="none" />
                <path d="M16.25 7.25v5.5M13.5 10h5.5" />
              </svg>
              <span>{t('library.importLocal')}</span>
            </button>
            {!!torrents.length && <span className="heading-count">{torrents.length.toString().padStart(2, '0')}</span>}
            <div className="view-toggle" role="tablist">
              <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'is-active' : ''} onClick={() => changeView('grid')} title={t('library.gridView')}>⊞</button>
              <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => changeView('list')} title={t('library.listView')}>☰</button>
            </div>
          </div>
        </div>
        {resumeCards.length > 0 && (
          <div className="resume-strip">
            <div className="resume-strip-head"><span>{t('library.continue')}</span><small>{t('library.continueHint')}</small></div>
            <div className="resume-strip-list">
              {resumeCards.map((card) => (
                <button className="resume-card" key={card.key} onClick={card.resume} title={`${t('library.play')}「${card.name}」`}>
                  {card.thumb}
                  <span className="resume-name">{card.name}</span>
                  <span className="resume-progress"><span style={{ width: `${watchPercent(card.watch)}%` }} /></span>
                  <small>{watchLabel(card.watch)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        {!!torrents.length && (
          <div className="library-tools library-filters">
            <label className="search-box"><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('library.search')} /></label>
            <div className="library-filter-controls">
              <select value={sort} onChange={(event) => changeSort(event.target.value as SortKey)} aria-label={t('library.sort')}>
                {SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </select>
              <select value={filter} onChange={(event) => changeFilter(event.target.value as FilterKey)} aria-label={t('library.filter')}>
                {FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{t(option.labelKey)}</option>)}
              </select>
              <span>{visible.length} / {torrents.length}</span>
            </div>
          </div>
        )}
        {!torrents.length && !localLibrary.length
          ? <div className="empty-state"><span>▣</span><strong>{t('library.empty')}</strong><p>{t('library.emptyHint')}</p></div>
          : !torrents.length
            ? null
            : !visible.length
            ? <div className="empty-state"><span>⌕</span><strong>{t('library.noMatch')}</strong><p>{t('library.noMatchHint')}</p></div>
            : view === 'grid'
            ? <div className="torrent-grid">{visible.map((item) => {
              const watch = watchMap[item.infoHash]
              return (
                <LibraryTile
                  key={item.infoHash}
                  thumb={<VideoThumb infoHash={item.infoHash} file={playableFile(item)} className="tile-icon" fallback={placeholderIcon(item)} />}
                  title={item.name}
                  tags={<><span className="task-type">{typeLabel(taskType(item))}</span>{episodeSummary(item) && <span className="episode-tag">{episodeSummary(item)}</span>}<WatchBadge watch={watch} /></>}
                  progress={watchPercent(watch)}
                  meta={metaLine(item)}
                  onClick={() => onSelectTorrent(item)}
                  onRemove={() => confirmRemove(item)}
                  removeTitle={t('downloads.remove')}
                />
              )
            })}</div>
            : <div className="library-list">{visible.map((item) => {
              const watch = watchMap[item.infoHash]
              return (
                <LibraryRow
                  key={item.infoHash}
                  thumb={<VideoThumb infoHash={item.infoHash} file={playableFile(item)} className="row-icon" fallback={placeholderIcon(item)} />}
                  title={item.name}
                  sub={<>{metaLine(item)}{episodeSummary(item) ? ` · ${episodeSummary(item)}` : ''}</>}
                  progress={watchPercent(watch)}
                  trailing={<WatchBadge watch={watch} />}
                  onClick={() => onSelectTorrent(item)}
                  onRemove={() => confirmRemove(item)}
                  removeTitle={t('downloads.remove')}
                />
              )
            })}</div>}
        {localSection}
      </div>
    )
  }

  const removeKeep = () => { if (window.confirm(t('library.removeConfirm', { name: torrent.name }))) onRemove(torrent, false) }
  const removeWithFiles = () => { if (window.confirm(t('library.deleteConfirm', { name: torrent.name }))) onRemove(torrent, true) }
  // 详情页来源：BT 展示磁力链接，直链/视频站点展示原始 URL（均支持复制，URL 可直接在浏览器打开）
  const isBt = taskType(torrent) === 'bt'
  const source = isBt ? torrent.magnetURI : torrent.sourceUrl || ''
  return (
    <div className="page-content">
      <button className="back-link" onClick={onBack}>{t('library.back')}</button>
      <div className="page-heading">
        <div><span className="eyebrow">{t('library.eyebrow')} / {torrent.infoHash.slice(0, 8)}</span><h2 title={torrent.name}>{torrent.name}</h2><p>{t('library.fileCount', { count: torrent.files.length })} · {formatSize(torrent.totalSize)}</p></div>
        <span className={`status-pill ${torrent.status}`}>{statusLabel(torrent.status)} {percentOf(torrent)}%</span>
      </div>
      <div className="thin-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div>
      <div className="detail-path source-path">
        <b>{isBt ? t('library.magnet') : t('library.source')}</b>
        <span title={source}>{source || t('downloads.unknown')}</span>
        {!!source && <button className="small-button" onClick={() => void copyText(source)}>{copied ? t('downloads.copied') : t('library.copyLink')}</button>}
        {!isBt && !!source && <button className="small-button" onClick={() => void ipc.openExternal(source)}>{t('library.openInBrowser')}</button>}
      </div>
      <div className="task-actions-row">
        <button className="small-button" onClick={removeKeep}>{t('library.removeRecord')}</button>
        <button className="small-button danger" onClick={removeWithFiles}>{t('library.deleteTask')}</button>
      </div>
      <div className="library-tools">
        <label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.searchFiles')} /></label>
        <span>{t('library.selectedFiles', { selected: files.filter((file) => file.selected !== false).length, total: files.length })}</span>
        {hiddenCount > 0 && (
          <button className="text-action" onClick={() => setShowAllFiles((value) => !value)}>
            {showAllFiles ? t('library.hideUnselected', { count: hiddenCount }) : t('library.showUnselected', { count: hiddenCount })}
          </button>
        )}
      </div>
      {!torrent.files.length
        ? <div className="empty-state"><span>◌</span><strong>{t('library.waitingFiles')}</strong><p>{t('library.waitingFilesHint')}</p></div>
        : !files.length
          ? <div className="empty-state"><strong>{t('library.noMatchingFiles')}</strong></div>
          : <div className="file-table"><div className="file-table-head"><span>{t('library.colName')}</span><span>{t('downloads.progress')}</span><span>{t('downloads.taskType')}</span><span>{t('downloads.size')}</span><span /></div>{files.map((file) => <FileRow key={file.path} infoHash={torrent.infoHash} file={file} onPlayFile={onPlayFile} />)}</div>}
    </div>
  )
}
export default FileList
