import React, { useState } from 'react'
import { ipc } from '../services/ipc'
import type { TorrentStatus } from '../types'
interface Props { torrents: TorrentStatus[]; onRefresh: () => void; onSelect: (torrent: TorrentStatus) => void }
const statusText = { parsing: '解析中', connecting: '连接中', downloading: '下载中', seeding: '已完成', paused: '已暂停', error: '错误' }
function format(value: number, suffix = 'B') { if (!value) return `0 ${suffix}`; const units = suffix === 'B/s' ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}` }
function time(value: number) { if (!value || !Number.isFinite(value)) return '计算中'; const seconds = Math.floor(value / 1000); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分钟` }
function shareRatio(torrent: TorrentStatus) { return torrent.downloaded > 0 ? (torrent.uploaded / torrent.downloaded).toFixed(2) : torrent.uploaded > 0 ? '∞' : '—' }

// 任务详情：aria2 引擎不提供逐 peer / 逐 tracker 状态，这里展示可得的聚合数据与文件明细
const TaskDetail: React.FC<{ torrent: TorrentStatus }> = ({ torrent }) => {
  const [copied, setCopied] = useState(false)
  const trackerCount = (torrent.magnetURI.match(/&tr=/g) || []).length
  const copyMagnet = async () => { try { await navigator.clipboard.writeText(torrent.magnetURI); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { window.alert('复制失败') } }
  return (
    <div className="task-detail">
      <div className="detail-facts">
        <span><b>InfoHash</b><code title={torrent.infoHash}>{torrent.infoHash}</code></span>
        <span><b>分享率</b>{shareRatio(torrent)}</span>
        <span><b>累计上传</b>{format(torrent.uploaded)}</span>
        <span><b>Tracker</b>{trackerCount} 个（引擎不提供逐个状态）</span>
      </div>
      <div className="detail-path">
        <b>保存路径</b>
        <span title={torrent.saveDir}>{torrent.saveDir || '未知'}</span>
        <button className="small-button" disabled={!torrent.saveDir} onClick={() => void ipc.openPath(torrent.saveDir)}>打开目录</button>
        <button className="small-button" onClick={() => void copyMagnet()}>{copied ? '已复制 ✓' : '复制磁力'}</button>
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

const DownloadManager: React.FC<Props> = ({ torrents, onRefresh, onSelect }) => {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const action = async (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => { setBusy(hash); try { const result = await task(); if (!result.success) window.alert(result.error || '操作失败'); else onRefresh() } catch (error) { window.alert(error instanceof Error ? error.message : '操作失败') } finally { setBusy(null) } }
  const remove = (torrent: TorrentStatus) => { if (window.confirm('移除这个下载任务？已下载的数据将保留。')) void action(torrent.infoHash, () => ipc.removeTorrent(torrent.infoHash, false)) }
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">下载队列</span><h2>下载任务</h2><p>{torrents.length ? `${torrents.length} 个本地任务正在管理` : '所有任务都会显示在这里'}</p></div><span className="heading-count">{torrents.length.toString().padStart(2, '0')}</span></div>{!torrents.length ? <div className="empty-state"><span>↓</span><strong>还没有下载任务</strong><p>添加磁力链接后，任务会出现在这里。</p></div> : <div className="download-stack">{torrents.map((torrent) => <article className="download-item" key={torrent.infoHash}><div className="download-main"><div className={`download-status ${torrent.status}`}><span />{statusText[torrent.status]}</div><h3 title={torrent.name}>{torrent.name}</h3><button className="text-action" onClick={() => setExpanded(expanded === torrent.infoHash ? null : torrent.infoHash)}>{expanded === torrent.infoHash ? '收起详情' : '详情'}</button><button className="text-action" onClick={() => onSelect(torrent)}>查看文件 →</button></div><div className="big-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div><div className="download-stats"><span><b>↓</b> {format(torrent.downloadSpeed, 'B/s')}</span><span><b>↑</b> {format(torrent.uploadSpeed, 'B/s')}</span><span>{torrent.numPeers} 个节点</span><span>{format(torrent.downloaded)} / {format(torrent.totalSize)}</span><span>剩余 {time(torrent.timeRemaining)}</span></div>{torrent.error && <p className="task-error">{torrent.error}</p>}{expanded === torrent.infoHash && <TaskDetail torrent={torrent} />}<div className="item-actions">{torrent.status === 'paused' ? <button className="small-button" disabled={busy === torrent.infoHash} onClick={() => void action(torrent.infoHash, () => ipc.resumeTorrent(torrent.infoHash))}>▶ 恢复</button> : <button className="small-button" disabled={busy === torrent.infoHash || torrent.status === 'seeding' || torrent.status === 'error'} onClick={() => void action(torrent.infoHash, () => ipc.pauseTorrent(torrent.infoHash))}>Ⅱ 暂停</button>}<button className="small-button danger" disabled={busy === torrent.infoHash} onClick={() => remove(torrent)}>× 移除</button></div></article>)}</div>}</div>
}
export default DownloadManager
