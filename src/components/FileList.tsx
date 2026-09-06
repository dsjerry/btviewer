import React, { useMemo, useState } from 'react'
import type { TorrentFileInfo, TorrentStatus } from '../types'
interface FileListProps {
  torrent: TorrentStatus | null
  torrents: TorrentStatus[]
  onSelectTorrent: (torrent: TorrentStatus) => void
  onPlayFile: (file: TorrentFileInfo) => void
  onRemove: (torrent: TorrentStatus, destroy: boolean) => void
  onBack: () => void
}
const labels = { video: '视频', audio: '音频', subtitle: '字幕', other: '其他' }
const statusLabels = { parsing: '解析中', connecting: '连接中', downloading: '下载中', seeding: '已完成', paused: '已暂停', error: '错误' }
const icons = { video: '▶', audio: '♫', subtitle: 'A', other: '•' }
function size(value: number) { if (!value) return '0 B'; const units = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}` }
const FileList: React.FC<FileListProps> = ({ torrent, torrents, onSelectTorrent, onPlayFile, onRemove, onBack }) => {
  const [query, setQuery] = useState('')
  const files = useMemo(() => torrent?.files.filter((file) => file.name.toLowerCase().includes(query.toLowerCase())) ?? [], [torrent, query])
  if (!torrent) return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">MEDIA LIBRARY</span><h2>媒体库</h2><p>选择一个任务浏览媒体文件，卡片右上角可移除记录</p></div></div><div className="torrent-grid">{torrents.length ? torrents.map((item) => <div className="torrent-tile" key={item.infoHash} onClick={() => onSelectTorrent(item)} role="button" tabIndex={0}><button className="tile-remove" title="移除该任务的记录（保留已下载文件）" onClick={(event) => { event.stopPropagation(); if (window.confirm(`移除「${item.name}」的记录？\n已下载的文件会保留在下载目录。`)) onRemove(item, false) }}>×</button><span className="tile-icon">◈</span><strong>{item.name}</strong><small>{item.files.length} 个文件 · {Math.round(item.progress * 100)}%</small></div>) : <div className="empty-state"><span>▣</span><strong>媒体库还是空的</strong><p>从首页添加一个磁力链接或 torrent 文件。</p></div>}</div></div>
  const removeKeep = () => { if (window.confirm(`移除「${torrent.name}」的记录？\n已下载的文件会保留在下载目录。`)) onRemove(torrent, false) }
  const removeWithFiles = () => { if (window.confirm(`删除「${torrent.name}」？\n该任务已下载的文件也会一并从磁盘删除，且无法恢复。`)) onRemove(torrent, true) }
  return <div className="page-content"><button className="back-link" onClick={onBack}>← 返回任务列表</button><div className="page-heading"><div><span className="eyebrow">MEDIA LIBRARY / {torrent.infoHash.slice(0, 8)}</span><h2>{torrent.name}</h2><p>{torrent.files.length} 个文件 · {size(torrent.totalSize)}</p></div><span className={`status-pill ${torrent.status}`}>{statusLabels[torrent.status]} {Math.round(torrent.progress * 100)}%</span></div><div className="thin-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div><div className="task-actions-row"><button className="small-button" onClick={removeKeep}>移除记录</button><button className="small-button danger" onClick={removeWithFiles}>删除任务和文件</button></div><div className="library-tools"><label className="search-box"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名" /></label><span>{files.length} / {torrent.files.length}</span></div>{!torrent.files.length ? <div className="empty-state"><span>◌</span><strong>正在等待文件信息</strong><p>连接到节点后，媒体文件会显示在这里。</p></div> : !files.length ? <div className="empty-state"><strong>没有匹配的文件</strong></div> : <div className="file-table"><div className="file-table-head"><span>文件名</span><span>类型</span><span>大小</span><span /></div>{files.map((file) => <div className="file-item" key={file.path}><div className="file-name"><span className={`file-icon ${file.type}`}>{icons[file.type]}</span><strong title={file.name}>{file.name}</strong></div><span className="file-type">{labels[file.type]}</span><span className="file-size">{size(file.size)}</span>{file.type === 'video' || file.type === 'audio' ? <button className="play-button" onClick={() => onPlayFile(file)}>播放 <span>↗</span></button> : <span />}</div>)}</div>}</div>
}
export default FileList
