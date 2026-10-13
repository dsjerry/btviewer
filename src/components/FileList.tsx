import React, { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
import { formatSize, STATUS_LABELS, taskType, TYPE_LABELS, watchLabel, watchPercent } from '../services/task-meta'
import type { TorrentFileInfo, TorrentStatus, WatchProgress } from '../types'
import getThumbnail from '../services/thumbnail'
interface FileListProps {
  torrent: TorrentStatus | null
  torrents: TorrentStatus[]
  onSelectTorrent: (torrent: TorrentStatus) => void
  onPlayFile: (file: TorrentFileInfo) => void
  onRemove: (torrent: TorrentStatus, destroy: boolean) => void
  onBack: () => void
}
const labels = { video: '视频', audio: '音频', subtitle: '字幕', other: '其他' }
const icons = { video: '▶', audio: '♫', subtitle: 'A', other: '•' }
const percentOf = (torrent: TorrentStatus) => Math.round(torrent.progress * 100)
// 任务的主播放文件：优先视频，其次音频（媒体库以「观看进度」为主，需定位到具体文件）
const playableFile = (torrent: TorrentStatus) => torrent.files.find((file) => file.type === 'video') || torrent.files.find((file) => file.type === 'audio')
// 媒体库不是下载列表：仅在尚未下载完成时补一句下载提示，已完成则不再显示状态
const downloadHint = (torrent: TorrentStatus) => {
  if (torrent.status === 'seeding') return ''
  return torrent.status === 'downloading' ? ` · 下载中 ${percentOf(torrent)}%` : ` · ${STATUS_LABELS[torrent.status]}`
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

interface FileRowProps { infoHash: string; file: TorrentFileInfo; onPlayFile: (file: TorrentFileInfo) => void }
// 文件行 memo：状态每秒刷新会重建 files 数组，内容相同的行直接跳过重渲染
const FileRow = memo<FileRowProps>(({ infoHash, file, onPlayFile }) => {
  const percent = file.size ? Math.min(100, Math.round((file.completed / file.size) * 100)) : 0
  return <div className="file-item"><div className="file-name">{file.type === 'video' ? <VideoThumb infoHash={infoHash} file={file} className="file-icon video" fallback="▶" /> : <span className={`file-icon ${file.type}`}>{icons[file.type]}</span>}<strong title={file.name}>{file.name}</strong></div><span className="file-progress"><span className="bar"><span style={{ width: `${percent}%` }} /></span><small>{percent}%</small></span><span className="file-type">{labels[file.type]}</span><span className="file-size">{formatSize(file.size)}</span>{file.type === 'video' || file.type === 'audio' ? <button className="play-button" onClick={() => onPlayFile(file)}>播放 <span>↗</span></button> : <span />}</div>
}, (a, b) => a.infoHash === b.infoHash && a.onPlayFile === b.onPlayFile && JSON.stringify(a.file) === JSON.stringify(b.file))

const FileList: React.FC<FileListProps> = ({ torrent, torrents, onSelectTorrent, onPlayFile, onRemove, onBack }) => {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState(false)
  // 媒体库视图：卡片网格 / 紧凑列表，偏好持久化
  const [view, setView] = useState<'grid' | 'list'>(() => (localStorage.getItem('btviewer-library-view') === 'list' ? 'list' : 'grid'))
  const changeView = (mode: 'grid' | 'list') => { setView(mode); localStorage.setItem('btviewer-library-view', mode) }
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2000) } catch { setCopied(false) }
  }
  const files = useMemo(() => torrent?.files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())) ?? [], [torrent, query])

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

  // 库列表：网格 / 紧凑列表共用同一份数据与移除确认逻辑
  const confirmRemove = (item: TorrentStatus) => { if (window.confirm(`移除「${item.name}」的记录？\n已下载的文件会保留在下载目录。`)) onRemove(item, false) }
  const removeButton = (item: TorrentStatus) => <button className="tile-remove" title="移除该任务的记录（保留已下载文件）" onClick={(event) => { event.stopPropagation(); confirmRemove(item) }}>×</button>
  const metaLine = (item: TorrentStatus) => `${TYPE_LABELS[taskType(item)]} · ${item.files.length} 个文件 · ${formatSize(item.totalSize)}${downloadHint(item)}`

  if (!torrent) {
    return (
      <div className="page-content">
        <div className="page-heading">
          <div><span className="eyebrow">媒体库</span><h2>媒体库</h2><p>选择一个任务浏览媒体文件，卡片右上角可移除记录</p></div>
          <div className="heading-side">
            {!!torrents.length && <span className="heading-count">{torrents.length.toString().padStart(2, '0')}</span>}
            <div className="view-toggle" role="tablist">
              <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'is-active' : ''} onClick={() => changeView('grid')} title="卡片视图">⊞</button>
              <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'is-active' : ''} onClick={() => changeView('list')} title="列表视图">☰</button>
            </div>
          </div>
        </div>
        {!torrents.length
          ? <div className="empty-state"><span>▣</span><strong>媒体库还是空的</strong><p>从首页添加一个磁力链接或 torrent 文件。</p></div>
          : view === 'grid'
            ? <div className="torrent-grid">{torrents.map((item) => {
              const watch = watchMap[item.infoHash]
              return (
                <div className="torrent-tile" key={item.infoHash} onClick={() => onSelectTorrent(item)} role="button" tabIndex={0}>
                  {removeButton(item)}
                  <VideoThumb infoHash={item.infoHash} file={playableFile(item)} className="tile-icon" fallback="◈" />
                  <strong title={item.name}>{item.name}</strong>
                  <div className="tile-tags">
                    <span className="task-type">{TYPE_LABELS[taskType(item)]}</span>
                    <WatchBadge watch={watch} />
                  </div>
                  <div className="tile-progress"><span style={{ width: `${watchPercent(watch)}%` }} /></div>
                  <small>{metaLine(item)}</small>
                </div>
              )
            })}</div>
            : <div className="library-list">{torrents.map((item) => {
              const watch = watchMap[item.infoHash]
              return (
                <div className="library-row" key={item.infoHash} onClick={() => onSelectTorrent(item)} role="button" tabIndex={0}>
                  <VideoThumb infoHash={item.infoHash} file={playableFile(item)} className="row-icon" fallback="◈" />
                  <div className="row-main">
                    <strong title={item.name}>{item.name}</strong>
                    <span className="row-sub">{metaLine(item)}</span>
                  </div>
                  <WatchBadge watch={watch} />
                  <span className="row-progress"><span className="bar"><span style={{ width: `${watchPercent(watch)}%` }} /></span></span>
                  {removeButton(item)}
                </div>
              )
            })}</div>}
      </div>
    )
  }

  const removeKeep = () => { if (window.confirm(`移除「${torrent.name}」的记录？\n已下载的文件会保留在下载目录。`)) onRemove(torrent, false) }
  const removeWithFiles = () => { if (window.confirm(`删除「${torrent.name}」？\n该任务已下载的文件也会一并从磁盘删除，且无法恢复。`)) onRemove(torrent, true) }
  // 详情页来源：BT 展示磁力链接，直链/视频站点展示原始 URL（均支持复制，URL 可直接在浏览器打开）
  const isBt = taskType(torrent) === 'bt'
  const source = isBt ? torrent.magnetURI : torrent.sourceUrl || ''
  return (
    <div className="page-content">
      <button className="back-link" onClick={onBack}>← 返回任务列表</button>
      <div className="page-heading">
        <div><span className="eyebrow">媒体库 / {torrent.infoHash.slice(0, 8)}</span><h2 title={torrent.name}>{torrent.name}</h2><p>{torrent.files.length} 个文件 · {formatSize(torrent.totalSize)}</p></div>
        <span className={`status-pill ${torrent.status}`}>{STATUS_LABELS[torrent.status]} {percentOf(torrent)}%</span>
      </div>
      <div className="thin-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div>
      <div className="detail-path source-path">
        <b>{isBt ? '磁力链接' : '来源链接'}</b>
        <span title={source}>{source || '未知'}</span>
        {!!source && <button className="small-button" onClick={() => void copyText(source)}>{copied ? '已复制 ✓' : '复制链接'}</button>}
        {!isBt && !!source && <button className="small-button" onClick={() => void ipc.openExternal(source)}>在浏览器打开 ↗</button>}
      </div>
      <div className="task-actions-row">
        <button className="small-button" onClick={removeKeep}>移除记录</button>
        <button className="small-button danger" onClick={removeWithFiles}>删除任务和文件</button>
      </div>
      <div className="library-tools"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名" /></label><span>{files.length} / {torrent.files.length}</span></div>
      {!torrent.files.length
        ? <div className="empty-state"><span>◌</span><strong>正在等待文件信息</strong><p>连接到节点后，媒体文件会显示在这里。</p></div>
        : !files.length
          ? <div className="empty-state"><strong>没有匹配的文件</strong></div>
          : <div className="file-table"><div className="file-table-head"><span>文件名</span><span>进度</span><span>类型</span><span>大小</span><span /></div>{files.map((file) => <FileRow key={file.path} infoHash={torrent.infoHash} file={file} onPlayFile={onPlayFile} />)}</div>}
    </div>
  )
}
export default FileList
