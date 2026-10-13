import React, { memo, useCallback, useState } from 'react'
import { ipc } from '../services/ipc'
import { STATUS_LABELS, TYPE_LABELS, taskType } from '../services/task-meta'
import type { TorrentStatus } from '../types'
interface Props { torrents: TorrentStatus[]; onRefresh: () => void; onSelect: (torrent: TorrentStatus) => void }
function format(value: number, suffix = 'B') { if (!value) return `0 ${suffix}`; const units = suffix === 'B/s' ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}` }
function time(value: number) { if (!value || !Number.isFinite(value)) return '计算中'; const seconds = Math.floor(value / 1000); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分钟` }
function shareRatio(torrent: TorrentStatus) { return torrent.downloaded > 0 ? (torrent.uploaded / torrent.downloaded).toFixed(2) : torrent.uploaded > 0 ? '∞' : '—' }

// 任务详情：aria2 引擎不提供逐 peer / 逐 tracker 状态，这里展示可得的聚合数据与文件明细
const TaskDetail: React.FC<{ torrent: TorrentStatus }> = ({ torrent }) => {
  const [copied, setCopied] = useState(false)
  const isBt = taskType(torrent) === 'bt'
  const trackerCount = (torrent.magnetURI.match(/&tr=/g) || []).length
  const copyText = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { window.alert('复制失败') } }
  return (
    <div className="task-detail">
      <div className="detail-facts">
        {isBt ? (
          <>
            <span><b>InfoHash</b><code title={torrent.infoHash}>{torrent.infoHash}</code></span>
            <span><b>分享率</b>{shareRatio(torrent)}</span>
            <span><b>累计上传</b>{format(torrent.uploaded)}</span>
            <span><b>Tracker</b>{trackerCount} 个（引擎不提供逐个状态）</span>
          </>
        ) : (
          <span><b>任务类型</b>{TYPE_LABELS[taskType(torrent)]}{torrent.type === 'video' ? '（yt-dlp 解析下载）' : ''}</span>
        )}
      </div>
      <div className="detail-path">
        <b>{isBt ? '保存路径' : '源链接'}</b>
        <span title={isBt ? torrent.saveDir : torrent.sourceUrl}>{isBt ? torrent.saveDir : (torrent.sourceUrl || '未知')}</span>
        <button className="small-button" disabled={!torrent.saveDir} onClick={() => void ipc.openPath(torrent.saveDir)}>打开目录</button>
        {isBt
          ? <button className="small-button" onClick={() => void copyText(torrent.magnetURI)}>{copied ? '已复制 ✓' : '复制磁力'}</button>
          : <button className="small-button" disabled={!torrent.sourceUrl} onClick={() => void copyText(torrent.sourceUrl || '')}>{copied ? '已复制 ✓' : '复制链接'}</button>}
      </div>
      {torrent.files.length > 0 && (
        <div className="detail-files">
          <div className="detail-files-head"><span>文件明细（{torrent.files.length}）</span><span>进度</span><span>大小</span></div>
          {torrent.files.map((file) => (
            <div className="detail-file" key={file.path}>
              <span title={file.name}>{file.name}</span>
              <span className="detail-file-bar"><span className="bar"><span style={{ width: `${file.size ? Math.min(100, (file.completed / file.size) * 100) : 0}%` }} /></span></span>
              <span>{format(file.size)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface CardProps {
  torrent: TorrentStatus
  busy: boolean
  expanded: boolean
  onSelect: (torrent: TorrentStatus) => void
  onToggle: (infoHash: string) => void
  onAction: (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => void
  onRemove: (torrent: TorrentStatus) => void
}
// 卡片 memo：状态每秒刷新，内容无变化的卡片直接跳过重渲染（展开详情时始终跟随最新数据）
const DownloadCard = memo<CardProps>(({ torrent, busy, expanded, onSelect, onToggle, onAction, onRemove }) => (
  <article className="download-item">
    <div className="download-main"><div className={`download-status ${torrent.status}`}><span />{STATUS_LABELS[torrent.status]}</div><span className="task-type">{TYPE_LABELS[taskType(torrent)]}</span><h3 title={torrent.name}>{torrent.name}</h3><button className="text-action" onClick={() => onToggle(torrent.infoHash)}>{expanded ? '收起详情' : '详情'}</button><button className="text-action" onClick={() => onSelect(torrent)}>查看文件 →</button></div>
    <div className="big-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div>
    <div className="download-stats"><span><b>↓</b> {format(torrent.downloadSpeed, 'B/s')}</span>{taskType(torrent) === 'bt' && <span><b>↑</b> {format(torrent.uploadSpeed, 'B/s')}</span>}<span>{taskType(torrent) === 'bt' ? `${torrent.numPeers} 个节点` : `${torrent.numPeers} 个连接`}</span><span>{format(torrent.downloaded)} / {format(torrent.totalSize)}</span>{torrent.status !== 'seeding' && <span>剩余 {time(torrent.timeRemaining)}</span>}</div>
    {torrent.error && <p className="task-error">{torrent.error}</p>}
    {expanded && <TaskDetail torrent={torrent} />}
    <div className="item-actions">{torrent.status === 'paused' ? <button className="small-button" disabled={busy} onClick={() => onAction(torrent.infoHash, () => ipc.resumeTorrent(torrent.infoHash))}>▶ 恢复</button> : <button className="small-button" disabled={busy || torrent.status === 'seeding' || torrent.status === 'error'} onClick={() => onAction(torrent.infoHash, () => ipc.pauseTorrent(torrent.infoHash))}>Ⅱ 暂停</button>}<button className="small-button danger" disabled={busy} onClick={() => onRemove(torrent)}>× 移除</button></div>
  </article>
), (a, b) => a.busy === b.busy && a.expanded === b.expanded && a.onSelect === b.onSelect && a.onToggle === b.onToggle && a.onAction === b.onAction && a.onRemove === b.onRemove && JSON.stringify(a.torrent) === JSON.stringify(b.torrent))

const DownloadManager: React.FC<Props> = ({ torrents, onRefresh, onSelect }) => {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 视图切换：进行中（解析/连接/下载/暂停/出错）与已完成
  const [tab, setTab] = useState<'active' | 'completed'>('active')
  const action = useCallback(async (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(hash)
    try { const result = await task(); if (!result.success) window.alert(result.error || '操作失败'); else onRefresh() } catch (error) { window.alert(error instanceof Error ? error.message : '操作失败') } finally { setBusy(null) }
  }, [onRefresh])
  const onAction = useCallback((hash: string, task: () => Promise<{ success: boolean; error?: string }>) => void action(hash, task), [action])
  const remove = useCallback((torrent: TorrentStatus) => { if (window.confirm('移除这个下载任务？已下载的数据将保留。')) void action(torrent.infoHash, () => ipc.removeTorrent(torrent.infoHash, false)) }, [action])
  const toggle = useCallback((infoHash: string) => setExpanded((current) => current === infoHash ? null : infoHash), [])
  const isBusy = useCallback((torrent: TorrentStatus) => busy === torrent.infoHash, [busy])
  const isExpanded = useCallback((torrent: TorrentStatus) => expanded === torrent.infoHash, [expanded])
  const active = torrents.filter((torrent) => torrent.status !== 'seeding')
  const completed = torrents.filter((torrent) => torrent.status === 'seeding')
  const visible = tab === 'active' ? active : completed
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">下载队列</span><h2>下载任务</h2><p>{torrents.length ? `${active.length} 个进行中 · ${completed.length} 个已完成` : '所有任务都会显示在这里'}</p></div><span className="heading-count">{torrents.length.toString().padStart(2, '0')}</span></div><div className="task-tabs" role="tablist"><button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>进行中 <b>{active.length}</b></button><button role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'is-active' : ''} onClick={() => setTab('completed')}>已完成 <b>{completed.length}</b></button></div>{!visible.length ? <div className="empty-state"><span>↓</span><strong>{tab === 'active' ? '没有进行中的任务' : '还没有完成的任务'}</strong><p>{tab === 'active' ? '添加磁力、直链或视频链接后，任务会出现在这里。' : '任务下载完成后会自动归档到这里。'}</p></div> : <div className="download-stack">{visible.map((torrent) => <DownloadCard key={torrent.infoHash} torrent={torrent} busy={isBusy(torrent)} expanded={isExpanded(torrent)} onSelect={onSelect} onToggle={toggle} onAction={onAction} onRemove={remove} />)}</div>}</div>
}
export default DownloadManager
