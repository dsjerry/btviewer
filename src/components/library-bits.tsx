import React, { useEffect, useState } from 'react'
import { t } from '../services/i18n'
import { watchLabel, watchPercent } from '../services/task-meta'
import type { TorrentFileInfo, TorrentStatus, WatchProgress } from '../types'
import getThumbnail from '../services/thumbnail'

// 媒体库展示件：首页影院行与 FileList 库视图共用的最小单元（缩略图/徽标/卡片/行）。

// 视频缩略图：从媒体流截帧（服务内含持久化与失败负缓存），截不出时回退图标
export const VideoThumb: React.FC<{ infoHash: string; file?: TorrentFileInfo; className: string; fallback: string }> = ({ infoHash, file, className, fallback }) => {
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

// 任务的主播放文件：优先视频，其次音频（媒体库以「观看进度」为主，需定位到具体文件）
export const playableFile = (torrent: TorrentStatus) => torrent.files.find((file) => file.type === 'video') || torrent.files.find((file) => file.type === 'audio')

// 无缩略图时的占位符号：音频用 ♫，其余用 ◈
export const placeholderIcon = (torrent: TorrentStatus) => (playableFile(torrent)?.type === 'audio' ? '♫' : '◈')

// 观看进度徽标：已看进度用强调色，未观看用弱化色
export const WatchBadge: React.FC<{ watch?: WatchProgress | null }> = ({ watch }) => {
  const percent = watchPercent(watch)
  return <span className={`watch-label ${percent > 0 ? 'is-watched' : ''}`}>{watchLabel(watch)}</span>
}

// 库条目容器（媒体库网格视图共用）：任务卡片与本地视频引用只是数据与交互不同，结构完全同构。
// 差异全部通过 props 注入（缩略图、标签、点击行为、移除确认），避免两份拷贝各自演化产生不一致。
// 交互模型（Plex 式）：单击打开（任务进详情 / 本地直接播放），悬停海报 ▶ 直接播放续播，
// 勾选框悬停浮现、仅用于批量归类；键盘 Enter 打开、空格勾选。
export interface LibraryTileProps {
  thumb: React.ReactNode
  title: string
  tags: React.ReactNode
  progress: number
  meta: React.ReactNode
  onOpen: () => void
  // 悬停 ▶ 直接播放/续播；无可播文件（或本地文件丢失）时传 null 隐藏按钮
  onPlay: (() => void) | null
  selected: boolean
  // 勾选入口：普通点击切换勾选，Shift+点击范围多选（由父级按 event.shiftKey 分流）
  onToggleSelected: (event?: React.MouseEvent) => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onRemove: () => void
  removeTitle: string
  isLocal?: boolean
  missing?: boolean
  onContextMenu: (event: React.MouseEvent) => void
}
export const LibraryTile: React.FC<LibraryTileProps> = ({ thumb, title, tags, progress, meta, onOpen, onPlay, selected, onToggleSelected, onDragStart, onRemove, removeTitle, isLocal, missing, onContextMenu }) => (
  <div className={`torrent-tile ${isLocal ? 'local-tile' : ''} ${missing ? 'is-missing' : ''} ${selected ? 'is-selected' : ''}`} onClick={(event) => { if (event.shiftKey) onToggleSelected(event); else onOpen() }} onContextMenu={onContextMenu} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); onOpen() } else if (event.target === event.currentTarget && event.key === ' ') { event.preventDefault(); onToggleSelected() } }} onDragStart={onDragStart} draggable role="button" tabIndex={0}>
    <div className="tile-poster">
      {thumb}
      <span className="tile-scrim" aria-hidden="true" />
      {progress > 0 && <div className="tile-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>}
      {onPlay && <button type="button" className="tile-play" title={`${t('library.play')}「${title}」`} aria-label={`${t('library.play')}「${title}」`} onClick={(event) => { event.stopPropagation(); onPlay() }}>▶</button>}
      <button type="button" className={`media-select ${selected ? 'is-selected' : ''}`} title={selected ? t('library.deselectItem') : t('library.selectItem')} aria-label={selected ? t('library.deselectItem') : t('library.selectItem')} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onToggleSelected(event) }}><span>{selected ? '✓' : ''}</span></button>
      <button type="button" className="tile-remove" title={removeTitle} onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
    </div>
    <div className="tile-body">
      <strong title={title}>{title}</strong>
      <div className="tile-tags">{tags}</div>
      <small>{meta}</small>
    </div>
  </div>
)

// 库条目容器（媒体库列表视图共用），与 LibraryTile 成对：同一套「单击打开 / 悬停播放 / 勾选归类」交互
export interface LibraryRowProps {
  thumb: React.ReactNode
  title: string
  sub: React.ReactNode
  collectionBadges?: React.ReactNode
  progress: number
  trailing?: React.ReactNode
  onOpen: () => void
  onPlay: (() => void) | null
  selected: boolean
  onToggleSelected: (event?: React.MouseEvent) => void
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onRemove: () => void
  removeTitle: string
  isLocal?: boolean
  missing?: boolean
  onContextMenu: (event: React.MouseEvent) => void
}
export const LibraryRow: React.FC<LibraryRowProps> = ({ thumb, title, sub, collectionBadges, progress, trailing, onOpen, onPlay, selected, onToggleSelected, onDragStart, onRemove, removeTitle, isLocal, missing, onContextMenu }) => (
  <div className={`library-row ${isLocal ? 'local-row' : ''} ${missing ? 'is-missing' : ''} ${selected ? 'is-selected' : ''}`} onClick={(event) => { if (event.shiftKey) onToggleSelected(event); else onOpen() }} onContextMenu={onContextMenu} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); onOpen() } else if (event.target === event.currentTarget && event.key === ' ') { event.preventDefault(); onToggleSelected() } }} onDragStart={onDragStart} draggable role="button" tabIndex={0}>
    <div className="row-poster">
      {thumb}
      <span className="tile-scrim" aria-hidden="true" />
      {onPlay && <button type="button" className="tile-play" title={`${t('library.play')}「${title}」`} aria-label={`${t('library.play')}「${title}」`} onClick={(event) => { event.stopPropagation(); onPlay() }}>▶</button>}
      <button type="button" className={`media-select ${selected ? 'is-selected' : ''}`} title={selected ? t('library.deselectItem') : t('library.selectItem')} aria-label={selected ? t('library.deselectItem') : t('library.selectItem')} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); onToggleSelected(event) }}><span>{selected ? '✓' : ''}</span></button>
    </div>
    <div className="row-main">
      <strong title={title}>{title}</strong>
      <span className="row-sub">{sub}</span>
      {collectionBadges}
    </div>
    {trailing}
    <span className="row-progress"><span className="bar"><span style={{ width: `${progress}%` }} /></span>{progress > 0 && <small>{progress}%</small>}</span>
    <button type="button" className="tile-remove" title={removeTitle} onClick={(event) => { event.stopPropagation(); onRemove() }}>×</button>
  </div>
)
