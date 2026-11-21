import { sameTorrentStatus } from '../services/torrent-diff'
import React, { memo, useCallback, useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import { statusLabel, typeLabel, taskType } from '../services/task-meta'
import { t } from '../services/i18n'
import { ConfirmDialog } from './ConfirmDialog'
import { validateSizeLimit } from '../services/validate'
import type { GlobalStat, TaskPeer, TorrentStatus } from '../types'

interface Props {
  torrents: TorrentStatus[]
  onRefresh: () => void
  onSelect: (torrent: TorrentStatus) => void
  focusHash?: string | null
  onFocusHandled?: () => void
  // FAB/浮层开合由 App 持有：通知跳转、直链下载完成等外部入口要能主动打开浮层
  open: boolean
  onOpenChange: (open: boolean) => void
  globalStat: GlobalStat | null
  activeCount: number
  // 播放页全屏观影时不渲染 FAB 与浮层
  visible?: boolean
}

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

// 解析中（拿 metadata）的卡片提示：冷门种子可能要几分钟，零 peer 时要告诉用户先确认资源本身
const ParsingHint = memo<{ torrent: TorrentStatus }>(({ torrent }) => {
  const [seconds, setSeconds] = useState(0)
  // 只在解析中计时；拿不到 peer 的常见原因是资源已死或运营商限制 BT 入站
  useEffect(() => {
    if (torrent.status !== 'parsing') { setSeconds(0); return }
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.round((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [torrent.status, torrent.infoHash])
  const stalled = seconds >= 45 && torrent.numPeers === 0
  return (
    <p className={`parsing-hint ${stalled ? 'is-stalled' : ''}`}>
      {stalled
        ? t('downloads.parsingNoPeers', { seconds })
        : seconds >= 10 ? t('downloads.parsingWait', { seconds }) : t('downloads.parsingHint')}
    </p>
  )
})

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
    {torrent.status === 'parsing' && <ParsingHint torrent={torrent} />}
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

// 下载浮层：导航不再有下载页，右下角 FAB 常驻入口（徽标=进行中任务数），点开浮层做完整管理
const DownloadsPanel: React.FC<Props> = ({ torrents, onRefresh, onSelect, focusHash, onFocusHandled, open, onOpenChange, globalStat, activeCount, visible = true }) => {
  const [busy, setBusy] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  // 视图切换：进行中（解析/连接/下载/暂停/出错）与已完成
  const [tab, setTab] = useState<'active' | 'completed'>('active')
  // 点系统通知跳转过来：打开浮层、切到对应分组并展开该任务详情
  useEffect(() => {
    if (!focusHash) return
    const target = torrents.find((torrent) => torrent.infoHash === focusHash)
    if (target) {
      onOpenChange(true)
      setTab(target.status === 'seeding' ? 'completed' : 'active')
      setExpanded(focusHash)
    }
    onFocusHandled?.()
  }, [focusHash, torrents, onFocusHandled, onOpenChange])
  // Esc 关闭浮层（ConfirmDialog 打开时由其自身拦截，冒泡到这里时确认框已关）
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])
  const action = useCallback(async (hash: string, task: () => Promise<{ success: boolean; error?: string }>) => {
    setBusy(hash)
    try { const result = await task(); if (!result.success) window.alert(result.error || t('downloads.actionFailed')); else onRefresh() } catch (error) { window.alert(error instanceof Error ? error.message : t('downloads.actionFailed')) } finally { setBusy(null) }
  }, [onRefresh])
  const onAction = useCallback((hash: string, task: () => Promise<{ success: boolean; error?: string }>) => void action(hash, task), [action])
  // 移除任务：先弹确认框，勾选「同时删除本地文件」才传 destroy=true（文件移入系统回收站）
  const [pendingRemove, setPendingRemove] = useState<TorrentStatus | null>(null)
  const remove = useCallback((torrent: TorrentStatus) => setPendingRemove(torrent), [])
  const confirmRemove = useCallback((destroy: boolean) => {
    if (pendingRemove) void action(pendingRemove.infoHash, () => ipc.removeTorrent(pendingRemove.infoHash, destroy))
    setPendingRemove(null)
  }, [pendingRemove, action])
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
  const tabItems = tab === 'active' ? active : completed
  const fabSpeed = globalStat && globalStat.downloadSpeed > 0 ? format(globalStat.downloadSpeed, 'B/s') : ''
  // 播放页全屏观影：FAB 与浮层都不出现（进入播放器前浮层已由 startPlay 收起）
  if (!visible) return null
  return <>
    <button className={`downloads-fab ${open ? 'is-open' : ''} ${activeCount > 0 ? 'is-active' : ''}`} onClick={() => onOpenChange(!open)} title={t('downloads.panelTitle')} aria-expanded={open} aria-label={t('downloads.panelTitle')}>
      <span className="fab-icon" aria-hidden="true">
        {open ? <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h9M8.5 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg> : <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7m0 0L4.5 6M8 9.5L11.5 6M2.5 12.5h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </span>
      {fabSpeed && <span className="fab-speed">{fabSpeed}</span>}
      {activeCount > 0 && <b className="fab-count">{activeCount > 99 ? '99+' : activeCount}</b>}
    </button>
    {open && (
      <div className="downloads-panel" role="dialog" aria-label={t('downloads.panelTitle')}>
        <div className="downloads-panel-head">
          <strong>{t('downloads.panelTitle')}</strong>
          <div className="task-tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'active'} className={tab === 'active' ? 'is-active' : ''} onClick={() => setTab('active')}>{t('downloads.tabActive')} <b>{active.length}</b></button>
            <button role="tab" aria-selected={tab === 'completed'} className={tab === 'completed' ? 'is-active' : ''} onClick={() => setTab('completed')}>{t('downloads.tabCompleted')} <b>{completed.length}</b></button>
          </div>
          <button className="panel-close" onClick={() => onOpenChange(false)} aria-label={t('shell.dismiss')}>×</button>
        </div>
        <div className="downloads-panel-actions">
          <span className="panel-summary">{torrents.length ? t('downloads.summary', { active: active.length, completed: completed.length }) : t('downloads.emptyActiveHint')}</span>
          <button className="small-button" disabled={batchBusy || !active.length} onClick={() => void batch(() => ipc.pauseAll())}>Ⅱ {t('downloads.pauseAll')}</button>
          <button className="small-button" disabled={batchBusy} onClick={() => void batch(() => ipc.resumeAll())}>▶ {t('downloads.resumeAll')}</button>
          <button className="small-button" disabled={batchBusy} onClick={() => void importList()}>⤓ {t('downloads.import')}</button>
          <button className="small-button" disabled={batchBusy} onClick={() => void exportList()}>⤒ {t('downloads.export')}</button>
        </div>
        <div className="downloads-panel-body">
          {!tabItems.length ? <div className="empty-state"><span>↓</span><strong>{tab === 'active' ? t('downloads.emptyActive') : t('downloads.emptyCompleted')}</strong><p>{tab === 'active' ? t('downloads.emptyActiveHint') : t('downloads.emptyCompletedHint')}</p></div> : <div className="download-stack">{tabItems.map((torrent) => <DownloadCard key={torrent.infoHash} torrent={torrent} busy={isBusy(torrent)} expanded={isExpanded(torrent)} onSelect={onSelect} onToggle={toggle} onAction={onAction} onRemove={remove} />)}<ConfirmDialog open={!!pendingRemove} message={pendingRemove ? t('downloads.removeConfirm', { name: pendingRemove.name }) : ''} checkboxLabel={t('confirm.removeWithFiles')} onConfirm={confirmRemove} onCancel={() => setPendingRemove(null)} /></div>}
        </div>
      </div>
    )}
  </>
}
export default DownloadsPanel
