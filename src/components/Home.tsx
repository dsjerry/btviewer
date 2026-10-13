import React, { useEffect, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
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

const Home: React.FC<HomeProps> = ({ parsingTask, onParsingChange, onTorrentAdded, onPlayFile, onDownload, onQuickDownload }) => {
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
    if (!isTaskInput(text)) { setNotice({ type: 'error', text: '请输入磁力链接、http(s)/ftp 下载链接或 .torrent/.metalink 文件路径' }); return }
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

  const addTask = () => void parseInput(magnetUri)

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
      if (!isTaskInput(text)) { setNotice({ type: 'error', text: '剪贴板中没有可识别的链接' }); return }
      setMagnetUri(text)
      await parseInput(text)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取剪贴板失败' }) }
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

  // 拖放解析：优先取 .torrent/.metalink 文件，其次取文本中的磁力或直链
  const dropFiles = async (event: React.DragEvent) => {
    const transfer = event.dataTransfer
    const taskFile = Array.from(transfer.files).find((item) => /\.(torrent|metalink|meta4)$/i.test(item.name))
    if (taskFile) { await parseTaskFile(ipc.getPathForFile(taskFile)); return }
    const text = transfer.getData('text/uri-list') || transfer.getData('text/plain')
    const magnet = text.split(/\s+/).find((item) => item.startsWith('magnet:?'))
    if (magnet) { setMagnetUri(magnet); await parseInput(magnet); return }
    const url = text.split(/\s+/).find((item) => /^(https?:\/\/|ftp:\/\/)/i.test(item))
    if (url) { setMagnetUri(url); await parseInput(url); return }
    setNotice({ type: 'error', text: '请拖入 .torrent/.metalink 文件或下载链接' })
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
        {dragging && <div className="drop-overlay"><strong>松开以添加任务</strong><small>支持 .torrent/.metalink 文件与磁力、直链</small></div>}
        <div className="result-panel">
          <button className="back-link" onClick={resetParse}>← 重新解析</button>
          <div className="result-heading">
            <span className="panel-icon">✓</span>
            <div>
              <span className="eyebrow">解析成功</span>
              <h2>{parsingTask.name}</h2>
              <p>{parsingTask.files.length ? `已解析出 ${parsingTask.files.length} 个文件 · 共 ${size(parsingTask.totalSize)}` : '正在等待节点返回文件信息…'}</p>
            </div>
          </div>
          {parsingTask.files.length ? (
            <>
              <div className="result-file-tools">
                <span>已选 {selectedFiles.size} / {parsingTask.files.length}</span>
                <button onClick={() => setSelectedFiles(new Set(parsingTask.files.map((file) => file.path)))}>全选</button>
                <button onClick={() => setSelectedFiles(new Set())}>清空</button>
                <small>仅勾选的文件会被下载</small>
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
                <button className="save-action" onClick={() => finishParsing(() => onTorrentAdded(parsingTask))}>保存到媒体库 <span>＋</span></button>
                {playable.length > 0 && <button className="play-action" onClick={() => finishParsing(() => onPlayFile(parsingTask, playable[0]))}>播放{playable.length > 1 ? '第一个媒体' : ''} <span>▶</span></button>}
                {playable.length === 0 && <span />}
                <button className="download-action" disabled={!selectedFiles.size} onClick={() => finishParsing(() => onDownload(parsingTask, [...selectedFiles]))}>{selectedFiles.size === parsingTask.files.length ? '下载全部资源' : `下载选中文件（${selectedFiles.size}）`} <span>↓</span></button>
              </div>
            </>
          ) : parsingTask.status === 'error' ? (
            <div className="waiting-result">
              <span>解析失败：{parsingTask.error || '未能在网络中找到该资源'}</span>
              <small>资源可能已无活跃节点，可点上方“← 重新解析”尝试其它链接</small>
            </div>
          ) : (
            <div className="waiting-result">
              <div className="loading-spinner" />
              <span>已解析链接，正在获取资源文件信息…</span>
              <small>获取到文件列表后会自动展示；在下方选择操作前不会开始下载</small>
            </div>
          )}
          <p className="privacy-note"><span>◉</span> 当前任务已解析，选择操作后才会开始对应行为</p>
        </div>
      </div>
    )
  }

  return (
    <div className="home-page" {...dragHandlers}>
      {dragging && <div className="drop-overlay"><strong>松开以添加任务</strong><small>支持 .torrent/.metalink 文件与磁力、直链</small></div>}
      <div className="add-panel">
        <div className="panel-kicker"><span className="panel-icon">+</span><div><strong>添加下载任务</strong><small>磁力/种子解析后选择操作，直链直接下载</small></div></div>
        <label htmlFor="magnet">下载链接</label>
        <textarea id="magnet" value={magnetUri} onChange={(event) => setMagnetUri(event.target.value)} placeholder="magnet:?xt=urn:btih:... 或 https://… / ftp://… 下载链接" rows={4} disabled={loading} />
        <button className="primary-action" onClick={addTask} disabled={loading}>{loading ? <span className="button-loader" /> : '添加任务'}<span>→</span></button>
        <div className="or-divider"><span>或者</span></div>
        <div className="alt-actions">
          <button className="secondary-action" onClick={() => void pasteInput()} disabled={loading}><span>⎘</span><span className="action-label">从剪贴板添加链接</span></button>
          <button className="secondary-action" onClick={() => void openFile()} disabled={loading} title="支持 .torrent / .metalink 文件"><span>⌁</span><span className="action-label">选择 .torrent / .metalink 文件</span></button>
        </div>
        {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
        <div className="privacy-note"><span>◉</span> 解析只在本机进行，不会上传你的文件</div>
      </div>
    </div>
  )
}
export default Home
