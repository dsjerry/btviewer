import React, { useEffect, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
import { t } from '../services/i18n'
import { LOCAL_MEDIA_FILE_RE } from '../services/task-meta'
import type { TorrentFileInfo, TorrentStatus } from '../types'

interface HomeProps {
  // 解析中的任务（App 级状态派生）：切页后回来不丢解析进度
  parsingTask: TorrentStatus | null
  onParsingChange: (hash: string | null) => void
  onTorrentAdded: (status?: TorrentStatus) => void
  onPlayFile: (status: TorrentStatus, file: TorrentFileInfo) => void
  onDownload: (status: TorrentStatus, filePaths?: string[]) => void
  // 直链/视频任务无需解析选择，加入队列后直接跳转下载页
  onQuickDownload: () => void
  // 拖入媒体文件（PotPlayer 式）：不经任务流程直接进播放器
  onDropMedia: (paths: string[]) => void
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

const Home: React.FC<HomeProps> = ({ parsingTask, onParsingChange, onTorrentAdded, onPlayFile, onDownload, onQuickDownload, onDropMedia }) => {
  const [magnetUri, setMagnetUri] = useState('')
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  // 勾选状态按任务初始化：文件列表首次到达时默认勾选全部媒体与字幕
  const selectionRef = useRef<{ hash: string; initialized: boolean }>({ hash: '', initialized: false })

  useEffect(() => {
    if (!parsingTask || !parsingTask.files.length) return
    if (selectionRef.current.hash === parsingTask.infoHash && selectionRef.current.initialized) return
    selectionRef.current = { hash: parsingTask.infoHash, initialized: true }
    setSelectedFiles(new Set(parsingTask.files.filter((file) => file.type !== 'other').map((file) => file.path)))
  }, [parsingTask])

  // 统一任务入口：BT 任务进入解析流程（三选一），直链/视频任务直接入队并跳转下载页
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
              <small>{t('home.waitingMetaHint')}</small>
            </div>
          )}
          <p className="privacy-note"><span>◉</span> {t('home.pendingNote')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="home-page" {...dragHandlers}>
      {dragging && <div className="drop-overlay"><strong>松开以添加任务</strong><small>支持 .torrent/.metalink 文件与磁力、直链，可一次拖入多个</small></div>}
      <div className="add-panel">
        <div className="panel-kicker"><span className="panel-icon">+</span><div><strong>{t('home.title')}</strong><small>{t('home.subtitle')}</small></div></div>
        <label htmlFor="magnet">{t('home.inputLabel')}</label>
        <textarea id="magnet" value={magnetUri} onChange={(event) => setMagnetUri(event.target.value)} placeholder={t('home.placeholder')} rows={4} disabled={loading} />
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
  )
}
export default Home
