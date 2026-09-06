import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import type { TorrentFileInfo, TorrentStatus } from '../types'

interface HomeProps {
  onTorrentAdded: (status?: TorrentStatus) => void
  onPlayFile: (status: TorrentStatus, file: TorrentFileInfo) => void
  onDownload: (status: TorrentStatus) => void
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

  useEffect(() => {
    if (!parsedTask) return
    return ipc.onStatusUpdate((status) => {
      if (status.infoHash === parsedTask.infoHash) setParsedTask(status)
    })
  }, [parsedTask?.infoHash])

  const addMagnet = async () => {
    const value = magnetUri.trim()
    if (!value.startsWith('magnet:?')) { setNotice({ type: 'error', text: '请输入以 magnet:? 开头的有效磁力链接' }); return }
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.addTorrent(value)
      if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || '解析任务失败' }); return }
      setMagnetUri(''); setParsedTask(result.data); setNotice(null)
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '解析磁力链接失败' }) } finally { setLoading(false) }
  }

  const openFile = async () => {
    setLoading(true); setNotice(null)
    try {
      const result = await ipc.openFile()
      if (result.success && result.data) setParsedTask(result.data)
      else if (!result.canceled) setNotice({ type: 'error', text: result.error || '解析文件失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '打开文件失败' }) } finally { setLoading(false) }
  }

  if (parsedTask) {
    const playable = parsedTask.files.filter((file) => file.type === 'video' || file.type === 'audio')
    return (
      <div className="home-page">
        <div className="result-panel">
          <button className="back-link" onClick={() => setParsedTask(null)}>← 重新解析</button>
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
              <div className="result-file-list">
                {parsedTask.files.map((file) => (
                  <div className="result-file" key={file.path}>
                    <span className={`file-icon ${file.type}`}>{typeIcons[file.type]}</span>
                    <span title={file.name}>{file.name}</span>
                    <small>{size(file.size)}</small>
                  </div>
                ))}
              </div>
              <div className="result-actions">
                <button className="save-action" onClick={() => onTorrentAdded(parsedTask)}>保存到媒体库 <span>＋</span></button>
                {playable.length > 0 && <button className="play-action" onClick={() => onPlayFile(parsedTask, playable[0])}>播放{playable.length > 1 ? '第一个媒体' : ''} <span>▶</span></button>}
                <button className="download-action" onClick={() => onDownload(parsedTask)}>下载全部资源 <span>↓</span></button>
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
    <div className="home-page">
      <div className="add-panel">
        <div className="panel-kicker"><span className="panel-icon">+</span><div><strong>添加媒体源</strong><small>解析后选择下一步操作</small></div></div>
        <label htmlFor="magnet">MAGNET LINK</label>
        <textarea id="magnet" value={magnetUri} onChange={(event) => setMagnetUri(event.target.value)} placeholder="magnet:?xt=urn:btih:..." rows={4} disabled={loading} />
        <button className="primary-action" onClick={() => void addMagnet()} disabled={loading}>{loading ? <span className="button-loader" /> : '解析链接'}<span>→</span></button>
        <div className="or-divider"><span>或者</span></div>
        <button className="secondary-action" onClick={() => void openFile()} disabled={loading}><span>⌁</span> 解析 .torrent 文件</button>
        {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
        <div className="privacy-note"><span>◉</span> 解析只在本机进行，不会上传你的文件</div>
      </div>
    </div>
  )
}
export default Home
