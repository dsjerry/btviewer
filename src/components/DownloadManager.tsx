import { sameTorrentStatus } from '../services/torrent-diff'
import React, { memo, useCallback, useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import { statusLabel, typeLabel, taskType } from '../services/task-meta'
import { t } from '../services/i18n'
import { validateSizeLimit } from '../services/validate'
import type { TaskPeer, TorrentStatus } from '../types'
interface Props { torrents: TorrentStatus[]; onRefresh: () => void; onSelect: (torrent: TorrentStatus) => void; focusHash?: string | null; onFocusHandled?: () => void }
function format(value: number, suffix = 'B') { if (!value) return `0 ${suffix}`; const units = suffix === 'B/s' ? ['B/s', 'KB/s', 'MB/s', 'GB/s'] : ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1); return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}` }
function time(value: number) { if (!value || !Number.isFinite(value)) return '计算中'; const seconds = Math.floor(value / 1000); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分钟` }
function shareRatio(torrent: TorrentStatus) { return torrent.downloaded > 0 ? (torrent.uploaded / torrent.downloaded).toFixed(2) : torrent.uploaded > 0 ? '∞' : '—' }

interface DetailProps { torrent: TorrentStatus; busy: boolean; onAction: (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => void }
// 任务详情：aria2 不提供逐个 tracker 的可用状态，但节点列表（getPeers）与 tracker 清单（announceList）
// 可以拿到——「0 节点/没速度」时这是最有用的诊断信息，因此按需加载而不随每秒状态刷新
const TaskDetail: React.FC<DetailProps> = ({ torrent, busy, onAction }) => {
  const [copied, setCopied] = useState(false)
  const [peers, setPeers] = useState<TaskPeer[] | null>(null)
  const [trackers, setTrackers] = useState<string[] | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [limit, setLimit] = useState('')
  const isBt = taskType(torrent) === 'bt'
  const trackerCount = (torrent.magnetURI.match(/&tr=/g) || []).length
  const copyText = async (text: string) => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { window.alert(t('downloads.copyFailed')) } }
  const limitError = validateSizeLimit(limit)

  const loadDiagnostics = async () => {
    setDiagLoading(true)
    try {
      const [peerResult, trackerResult] = await Promise.all([ipc.taskPeers(torrent.infoHash), ipc.taskTrackers(torrent.infoHash)])
      setPeers(peerResult.success && peerResult.data ? peerResult.data : [])
      setTrackers(trackerResult.success && trackerResult.data ? trackerResult.data : [])
    } finally { setDiagLoading(false) }
  }

  const sortedPeers = peers ? [...peers].sort((a, b) => b.downloadSpeed - a.downloadSpeed) : null
  return (
    <div className="task-detail">
      <div className="detail-facts">
        {isBt ? (
          <>
            <span><b>InfoHash</b><code title={torrent.infoHash}>{torrent.infoHash}</code></span>
            <span><b>{t('downloads.shareRatio')}</b>{shareRatio(torrent)}</span>
            <span><b>{t('downloads.uploadedTotal')}</b>{format(torrent.uploaded)}</span>
            <span><b>{t('downloads.trackerCount')}</b>{t('downloads.trackerCountValue', { count: trackerCount })}</span>
            {torrent.queuePosition !== undefined && <span><b>{t('downloads.queuePositionLabel')}</b>{torrent.queuePosition + 1}</span>}
          </>
        ) : (
          <span><b>{t('downloads.taskType')}</b>{typeLabel(taskType(torrent))}{torrent.type === 'video' ? t('downloads.viaYtdlp') : ''}</span>
        )}
      </div>
      <div className="detail-path">
        <b>{isBt ? t('downloads.savePath') : t('downloads.sourceLink')}</b>
        <span title={isBt ? torrent.saveDir : torrent.sourceUrl}>{isBt ? torrent.saveDir : (torrent.sourceUrl || t('downloads.unknown'))}</span>
        <button className="small-button" disabled={!torrent.saveDir} onClick={() => void ipc.openPath(torrent.saveDir)}>{t('downloads.openDir')}</button>
        {isBt
          ? <button className="small-button" onClick={() => void copyText(torrent.magnetURI)}>{copied ? t('downloads.copied') : t('downloads.copyMagnet')}</button>
          : <button className="small-button" disabled={!torrent.sourceUrl} onClick={() => void copyText(torrent.sourceUrl || '')}>{copied ? t('downloads.copied') : t('downloads.copyLink')}</button>}
      </div>
      {/* 单任务限速：只影响该任务，全局限速仍在设置页 */}
      <div className="task-limit">
        <input type="text" className={limitError ? 'has-error' : ''} value={limit} onChange={(event) => setLimit(event.target.value)} placeholder={t('downloads.limitPlaceholder')} />
        <button className="small-button" disabled={busy || !!limitError} onClick={() => onAction(torrent.infoHash, () => ipc.setTaskSpeedLimit(torrent.infoHash, limit))}>{t('downloads.applyLimit')}</button>
        {limitError && <span className="field-error">{limitError}</span>}
      </div>
      {isBt && (
        <div className="task-diag">
          <div className="task-diag-head"><span>{t('downloads.peersAndTrackers')}</span><button className="small-button" disabled={diagLoading} onClick={() => void loadDiagnostics()}>{diagLoading ? t('downloads.loading') : peers ? t('downloads.refresh') : t('downloads.view')}</button></div>
          {sortedPeers && (sortedPeers.length ? (
            <div className="peer-list">
              {sortedPeers.slice(0, 80).map((peer) => (
                <div className={`peer-row ${peer.seeder ? 'is-seeder' : ''}`} key={`${peer.ip}:${peer.port}`}>
                  <span title={`${peer.ip}:${peer.port}`}>{peer.ip}:{peer.port}</span>
                  <span>↓ {format(peer.downloadSpeed, 'B/s')}</span>
                  <span>↑ {format(peer.uploadSpeed, 'B/s')}</span>
                  <span>{peer.seeder ? t('downloads.seeder') : peer.choked ? t('downloads.choked') : t('downloads.transferring')}</span>
                </div>
              ))}
            </div>
          ) : <p className="task-error">{t('downloads.noPeers')}</p>)}
          {trackers && (
            <div className="tracker-list">
              {trackers.length ? trackers.map((tracker) => <span key={tracker} title={tracker}>{tracker}</span>) : <span>{t('downloads.noTrackers')}</span>}
            </div>
          )}
        </div>
      )}
      {torrent.files.length > 0 && (
        <div className="detail-files">
          <div className="detail-files-head"><span>{t('downloads.filesDetail', { count: torrent.files.length })}</span><span>{t('downloads.progress')}</span><span>{t('downloads.size')}</span></div>
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
    <div className="download-main"><div className={`download-status ${torrent.status}`}><span />{statusLabel(torrent.status)}</div><span className="task-type">{typeLabel(taskType(torrent))}</span><h3 title={torrent.name}>{torrent.name}</h3><button className="text-action" onClick={() => onToggle(torrent.infoHash)}>{expanded ? t('downloads.hideDetail') : t('downloads.detail')}</button><button className="text-action" onClick={() => onSelect(torrent)}>{t('downloads.viewFiles')}</button></div>
    <div className="big-progress"><span style={{ width: `${torrent.progress * 100}%` }} /></div>
    <div className="download-stats"><span><b>↓</b> {format(torrent.downloadSpeed, 'B/s')}</span>{taskType(torrent) === 'bt' && <span><b>↑</b> {format(torrent.uploadSpeed, 'B/s')}</span>}<span>{taskType(torrent) === 'bt' ? t('downloads.peers', { count: torrent.numPeers }) : t('downloads.connections', { count: torrent.numPeers })}</span><span>{format(torrent.downloaded)} / {format(torrent.totalSize)}</span>{torrent.status !== 'seeding' && <span>{t('downloads.remaining', { time: time(torrent.timeRemaining) })}</span>}{torrent.queuePosition !== undefined && <span>{t('downloads.queuePosition', { position: torrent.queuePosition + 1 })}</span>}</div>
    {torrent.error && <p className="task-error">{torrent.error}</p>}
    {expanded && <TaskDetail torrent={torrent} busy={busy} onAction={onAction} />}
    <div className="item-actions">
      {torrent.status === 'paused' ? <button className="small-button" disabled={busy} onClick={() => onAction(torrent.infoHash, () => ipc.resumeTorrent(torrent.infoHash))}>{t('downloads.resume')}</button> : <button className="small-button" disabled={busy || torrent.status === 'seeding' || torrent.status === 'error'} onClick={() => onAction(torrent.infoHash, () => ipc.pauseTorrent(torrent.infoHash))}>{t('downloads.pause')}</button>}
      {torrent.status === 'error' && <button className="small-button" disabled={busy} onClick={() => onAction(torrent.infoHash, () => ipc.retryTorrent(torrent.infoHash))}>{t('downloads.retry')}</button>}
      {torrent.queuePosition !== undefined && <>
        <button className="small-button" disabled={busy || torrent.queuePosition === 0} onClick={() => onAction(torrent.infoHash, () => ipc.moveTask(torrent.infoHash, 'top'))}>{t('downloads.pinTop')}</button>
        <button className="small-button" disabled={busy || torrent.queuePosition === 0} onClick={() => onAction(torrent.infoHash, () => ipc.moveTask(torrent.infoHash, 'up'))}>{t('downloads.moveUp')}</button>
      </>}
      <button className="small-button danger" disabled={busy} onClick={() => onRemove(torrent)}>{t('downloads.remove')}</button>
    </div>
  </article>
), (a, b) => a.busy === b.busy && a.expanded === b.expanded && a.onSelect === b.onSelect && a.onToggle === b.onToggle && a.onAction === b.onAction && a.onRemove === b.onRemove && sameTorrentStatus(a.torrent, b.torrent))

const DownloadManager: React.FC<Props> = ({ torrents, onRefresh, onSelect, focusHash, onFocusHandled }) => {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 视图切换：进行中（解析/连接/下载/暂停/出错）与已完成
  const [tab, setTab] = useState<'active' | 'completed'>('active')
  // 点系统通知跳转过来：切到对应分组并展开该任务详情
  useEffect(() => {
    if (!focusHash) return
    const target = torrents.find((torrent) => torrent.infoHash === focusHash)
    if (target) {
      setTab(target.status === 'seeding' ? 'completed' : 'active')
      setExpanded(focusHash)
    }
    onFocusHandled?.()
  }, [focusHash, torrents, onFocusHandled])
  const action = useCallback(async (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(hash)
    try { const result = await task(); if (!result.success) window.alert(result.error || t('downloads.actionFailed')); else onRefresh() } catch (error) { window.alert(error instanceof Error ? error.message : t('downloads.actionFailed')) } finally { setBusy(null) }
  }, [onRefresh])
  const onAction = useCallback((hash: string, task: () => Promise<{ success: boolean; error?: string }>) => void action(hash, task), [action])
  const remove = useCallback((torrent: TorrentStatus) => { if (window.confirm(t('downloads.removeConfirm'))) void action(torrent.infoHash, () => ipc.removeTorrent(torrent.infoHash, false)) }, [action])
  const toggle = useCallback((infoHash: string) => setExpanded((current) => current === infoHash ? null : infoHash), [])
  const isBusy = useCallback((torrent: TorrentStatus) => busy === torrent.infoHash, [busy])
  const isExpanded = useCallback((torrent: TorrentStatus) => expanded === torrent.infoHash, [expanded])
  // 队列批量操作：全部暂停记录本次暂停的任务，恢复全部只恢复这些（不会顺带启动用户自己暂停或待选择的任务）
  const [batchBusy, setBatchBusy] = useState(false)
  const batch = useCallback(async (task: () => Promise<{ success: boolean; error?: string; data?: unknown }>) => {
    setBatchBusy(true)
    try {
      const result = await task()
      if (!result.success) window.alert(result.error || t('downloads.actionFailed'))
      else onRefresh()
    } catch (error) { window.alert(error instanceof Error ? error.message : t('downloads.actionFailed')) } finally { setBatchBusy(false) }
  }, [onRefresh])
  // 清单导出/导入（A6）：导出便于备份与跨设备迁移，导入会跳过已存在的来源
  const exportList = useCallback(async () => {
    setBatchBusy(true)
    try {
      const result = await ipc.exportTasks()
      if (!result.success) { if (!result.canceled) window.alert(result.error || t('downloads.exportFailed')); return }
      window.alert(t('downloads.exported', { count: result.data?.count ?? 0, path: result.data?.path || '' }))
    } catch (error) { window.alert(error instanceof Error ? error.message : t('downloads.exportFailed')) } finally { setBatchBusy(false) }
  }, [])
  const importList = useCallback(async () => {
    setBatchBusy(true)
    try {
      const result = await ipc.importTasks()
      if (!result.success) { if (!result.canceled) window.alert(result.error || t('downloads.importFailed')); return }
      const { added, skipped, failed, errors } = result.data!
      onRefresh()
      window.alert(`${t('downloads.imported', { added, skipped })}${failed ? `，${t('home.batchFailed', { count: failed })}\n${errors.slice(0, 5).join('\n')}` : ''}`)
    } catch (error) { window.alert(error instanceof Error ? error.message : t('downloads.importFailed')) } finally { setBatchBusy(false) }
  }, [onRefresh])
  const active = torrents.filter((torrent) => torrent.status !== 'seeding')
  const completed = torrents.filter((torrent) => torrent.status === 'seeding')
  const visible = tab === 'active' ? active : completed
  return <div className="page-content"><div className="page-heading"><div><span className="eyebrow">{t('downloads.eyebrow')}</span><h2>{t('downloads.title')}</h2><p>{torrents.length ? t('downloads.summary', { active: active.length, completed: completed.length }) : t('downloads.emptyActiveHint')}</p></div><div className="heading-side"><span className="heading-count">{torrents.length.toString().padStart(2, '0')}</span><div className="heading-actions"><button className="small-button" disabled={batchBusy || !active.length} onClick={() => void batch(() => ipc.pauseAll())}>Ⅱ {t('downloads.pauseAll')}</button><button className="small-button" disabled={batchBusy} onClick={() => void batch(() => ipc.resumeAll())}>▶ {t('downloads.resumeAll')}</button><button className="small-button" disabled={batchBusy} onClick={() => void importList()}>⤓ {t('downloads.import')}</button><button className="small-button" disabled={batchBusy} onClick={() => void exportList()}>⤒ {t('downloads.export')}</button></div></div></div><div className="task-tabs" role="tablist"><button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>{t('downloads.tabActive')} <b>{active.length}</b></button><button role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'is-active' : ''} onClick={() => setTab('completed')}>{t('downloads.tabCompleted')} <b>{completed.length}</b></button></div>{!visible.length ? <div className="empty-state"><span>↓</span><strong>{tab === 'active' ? t('downloads.emptyActive') : t('downloads.emptyCompleted')}</strong><p>{tab === 'active' ? t('downloads.emptyActiveHint') : t('downloads.emptyCompletedHint')}</p></div> : <div className="download-stack">{visible.map((torrent) => <DownloadCard key={torrent.infoHash} torrent={torrent} busy={isBusy(torrent)} expanded={isExpanded(torrent)} onSelect={onSelect} onToggle={toggle} onAction={onAction} onRemove={remove} />)}</div>}</div>
}
export default DownloadManager
