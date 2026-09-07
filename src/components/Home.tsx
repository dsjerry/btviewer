import React, { useEffect, useRef, useState } from 'react'
import { ipc } from '../services/ipc'
import type { TorrentFileInfo, TorrentStatus } from '../types'

interface HomeProps {
  onTorrentAdded: (status?: TorrentStatus) => void
  onPlayFile: (status: TorrentStatus, file: TorrentFileInfo) => void
  onDownload: (status: TorrentStatus, filePaths?: string[]) => void
}

const typeIcons: Record<TorrentFileInfo['type'], string> = { video: '▶', audio: '♫', subtitle: 'A', other: '•' }

function size(value: number) {
  if (!value) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`
}

const Home: React.FC<HomeProps> = ({ onTorrentAdded, onPlayFile, onDownload }) => {
  const [magnetUri, setMagnetUri] = useState('')
  const [loading, setLoading] = useState(false)
  const [parsedTask, setParsedTask] = useState<TorrentStatus | null>(null)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  // 勾选状态按任务初始化：文件列表首次到达时默认勾选全部媒体与字幕
  const selectionRef = useRef<{ hash: string; initialized: boolean }>({ hash: '', initialized: false })

  useEffect(() => {
    if (!parsedTask || !parsedTask.files.length) return
    if (selectionRef.current.hash === parsedTask.infoHash && selectionRef.current.initialized) return
    selectionRef.current = { hash: parsedTask.infoHash, initialized: true }
    setSelectedFiles(new Set(parsedTask.files.filter((file) => file.type !== 'other').map((file) => file.path)))
  }, [parsedTask])

  useEffect(() => {
    if (!parsedTask) return
    return ipc.onStatusUpdate((status) => {
      if (status.infoHash === parsedTask.infoHash) setParsedTask(status)
    })
  }, [parsedTask?.infoHash])

  const parseMagnet = async (value: string) => {
    if (!value.startsWith('magnet:?')) { setNotice({ type: 'error', text: '请输入以 magnet:? 开头的有效磁力链接' }); return }
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTorrent(value)
      if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || '解析任务失败' }); return }
      setMagnetUri(''); setParsedTask(result.data); setNotice(null)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '解析磁力链接失败' }) } finally { setLoading(false) }
  }

  const addMagnet = () => void parseMagnet(magnetUri.trim())

  const parseTorrentFile = async (path: string) => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTorrent(path)
      if (result.success && result.data) setParsedTask(result.data)
      else setNotice({ type: 'error', text: result.error || '解析文件失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '解析文件失败' }) } finally { setLoading(false) }
  }

  // 剪贴板解析：读到磁力链接后自动填入并解析
  const pasteMagnet = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim()
      if (!text.startsWith('magnet:?')) { setNotice({ type: 'error', text: '剪贴板内容不是磁力链接' }); return }
      setMagnetUri(text)
      await parseMagnet(text)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取剪贴板失败' }) }
  }

  const openFile = async () => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.openFile()
      if (result.success && result.data) setParsedTask(result.data)
      else if (!result.canceled) setNotice({ type: 'error', text: result.error || '解析文件失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '打开文件失败' }) } finally { setLoading(false) }
  }

  const toggleFile = (path: string) => setSelectedFiles((current) => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next })

  const resetParse = () => {
    setParsedTask(null)
    selectionRef.current = { hash: '', initialized: false }
    setSelectedFiles(new Set())
  }

  // 拖放解析：优先取 .torrent 文件，其次取文本中的磁力链接
  const dropFiles = async (event: React.DragEvent) => {
    const transfer = event.dataTransfer
    const torrent = Array.from(transfer.files).find((item) => item.name.toLowerCase().endsWith('.torrent'))
    if (torrent) { await parseTorrentFile(ipc.getPathForFile(torrent)); return }
    const text = transfer.getData('text/uri-list') || transfer.getData('text/plain')
    const magnet = text.split(/\s+/).find((item) => item.startsWith('magnet:?'))
    if (magnet) { setMagnetUri(magnet); await parseMagnet(magnet); return }
    setNotice({ type: 'error', text: '请拖入 .torrent 文件或磁力链接' })
  }

  // 用计数器处理嵌套元素的 dragenter/dragleave，避免子元素误触发遮罩闪烁
  const dragHandlers = {
    onDragEnter: (event: React.DragEvent) => { event.preventDefault(); dragDepth.current += 1; setDragging(true) },
    onDragOver: (event: React.DragEvent) => event.preventDefault(),
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false) },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void dropFiles(event) }
  }

  if (parsedTask) {
    const playable = parsedTask.files.filter((file) => file.type === 'video' || file.type === 'audio')
    return (
      <div className="home-page" {...dragHandlers}>
        {dragging && <div className="drop-overlay"><strong>松开以解析资源</strong><small>支持 .torrent 文件与磁力链接</small></div>}
        <div className="result-panel">
          <button className="back-link" onClick={resetParse}>← 重新解析</button>
          <div className="result-heading">
            <span className="panel-icon">✓</span>
            <div>
              <span className="eyebrow">PARSED SUCCESSFULLY</span>
              <h2>{parsedTask.name}</h2>
              <p>{parsedTask.files.length ? `已解析出 ${parsedTask.files.length} 个文件 · 共 ${size(parsedTask.totalSize)}` : '正在等待节点返回文件信息…'}</p>
            </div>
          </div>
          {parsedTask.files.length ? (
            <>
              <div className="result-file-tools">
                <span>已选 {selectedFiles.size} / {parsedTask.files.length}</span>
                <button onClick={() => setSelectedFiles(new Set(parsedTask.files.map((file) => file.path)))}>全选</button>
                <button onClick={() => setSelectedFiles(new Set())}>清空</button>
                <small>仅勾选的文件会被下载</small>
              </div>
              <div className="result-file-list">
                {parsedTask.files.map((file) => (
                  <label className="result-file" key={file.path}>
                    <input type="checkbox" checked={selectedFiles.has(file.path)} onChange={() => toggleFile(file.path)} />
                    <span className={`file-icon ${file.type}`}>{typeIcons[file.type]}</span>
                    <span title={file.name}>{file.name}</span>
                    <small>{size(file.size)}</small>
                  </label>
                ))}
              </div>
              <div className="result-actions">
                <button className="save-action" onClick={() => onTorrentAdded(parsedTask)}>保存到媒体库 <span>＋</span></button>
                {playable.length > 0 && <button className="play-action" onClick={() => onPlayFile(parsedTask, playable[0])}>播放{playable.length > 1 ? '第一个媒体' : ''} <span>▶</span></button>}
                {playable.length === 0 && <span />}
                <button className="download-action" disabled={!selectedFiles.size} onClick={() => onDownload(parsedTask, [...selectedFiles])}>{selectedFiles.size === parsedTask.files.length ? '下载全部资源' : `下载选中文件（${selectedFiles.size}）`} <span>↓</span></button>
              </div>
            </>
          ) : parsedTask.status === 'error' ? (
            <div className="waiting-result">
              <span>解析失败：{parsedTask.error || '未能在网络中找到该资源'}</span>
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
      {dragging && <div className="drop-overlay"><strong>松开以解析资源</strong><small>支持 .torrent 文件与磁力链接</small></div>}
      <div className="add-panel">
        <div className="panel-kicker"><span className="panel-icon">+</span><div><strong>添加媒体源</strong><small>解析后选择下一步操作</small></div></div>
        <label htmlFor="magnet">MAGNET LINK</label>
        <textarea id="magnet" value={magnetUri} onChange={(event) => setMagnetUri(event.target.value)} placeholder="magnet:?xt=urn:btih:..." rows={4} disabled={loading} />
        <button className="primary-action" onClick={addMagnet} disabled={loading}>{loading ? <span className="button-loader" /> : '解析链接'}<span>→</span></button>
        <div className="or-divider"><span>或者</span></div>
        <div className="alt-actions">
          <button className="secondary-action" onClick={() => void pasteMagnet()} disabled={loading}><span>⎘</span> 从剪贴板解析磁力</button>
          <button className="secondary-action" onClick={() => void openFile()} disabled={loading}><span>⌁</span> 解析 .torrent 文件</button>
        </div>
        {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
        <div className="privacy-note"><span>◉</span> 解析只在本机进行，不会上传你的文件</div>
      </div>
    </div>
  )
}
export default Home
