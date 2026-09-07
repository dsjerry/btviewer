import React, { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import type TextTrack from 'video.js/dist/types/tracks/text-track'
import 'video.js/dist/video-js.css'
import { ipc } from '../services/ipc'
import type { TorrentFileInfo } from '../types'

type VjsPlayer = ReturnType<typeof videojs>
// video.js 的 d.ts 不完整：漏掉了 .track（运行时存在）以及 TextTrack 的 mode/label，这里补齐类型
type SubtitleTrack = TextTrack & { mode: 'disabled' | 'hidden' | 'showing'; label: string }
type RemoteTrackElement = ReturnType<VjsPlayer['addRemoteTextTrack']> & { track: SubtitleTrack }

interface PlayerProps { infoHash: string; file: TorrentFileInfo; subtitles: TorrentFileInfo[]; onBack: () => void }

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
}
// Chromium 无法解码的常见容器：重试没有意义，直接提示
const UNSUPPORTED = ['.mkv', '.avi', '.wmv', '.flv', '.rmvb', '.ts']

function getMime(name: string) { return MIME[name.toLowerCase().slice(name.lastIndexOf('.'))] || 'application/octet-stream' }

function isUnsupported(name: string) { return UNSUPPORTED.includes(name.toLowerCase().slice(name.lastIndexOf('.'))) }

function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

type StreamState = 'ready' | 'waiting' | 'failed'

// 探测流服务是否已有数据：文件尚未下载到磁盘时返回 404
async function probeStream(url: string, signal: AbortSignal): Promise<StreamState> {
  try {
    const res = await fetch(url, { headers: { Range: 'bytes=0-0' }, signal })
    if (res.status === 200 || res.status === 206) return 'ready'
    if (res.status === 404) return 'waiting'
    return 'failed'
  } catch {
    return signal.aborted ? 'waiting' : 'failed'
  }
}

const Player: React.FC<PlayerProps> = ({ infoHash, file, subtitles, onBack }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<VjsPlayer | null>(null)
  const trackElementsRef = useRef<RemoteTrackElement[]>([])
  const lastSaveRef = useRef(0)
  const [playerReady, setPlayerReady] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusText, setStatusText] = useState('正在准备媒体流…')
  const [error, setError] = useState<string | null>(null)
  const [resumeNotice, setResumeNotice] = useState<string | null>(null)
  const [subtitleItems, setSubtitleItems] = useState<Array<{ name: string; url: string }>>([])
  const [selectedSubtitle, setSelectedSubtitle] = useState(-1)

  // 任务状态每秒刷新会让 files 数组身份不断变化，用路径签名避免重复请求字幕 URL
  const subtitleKey = subtitles.map((item) => item.path).join('\n')

  useEffect(() => {
    let active = true
    void (async () => {
      const items: Array<{ name: string; url: string }> = []
      for (const item of subtitles) {
        try { items.push({ name: item.name.replace(/\.[^.]+$/, ''), url: await ipc.getSubtitleUrl(infoHash, item.path) }) } catch { /* 单个字幕不可用不影响其它 */ }
      }
      if (active) setSubtitleItems(items)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoHash, subtitleKey])

  // 字幕轨挂载：等播放器与字幕 URL 都就绪后执行；与视频同名（去扩展名）的字幕自动选中
  useEffect(() => {
    const player = playerRef.current
    if (!playerReady || !player || player.isDisposed() || !subtitleItems.length) return
    const base = file.name.replace(/\.[^.]+$/, '').toLowerCase()
    const added: RemoteTrackElement[] = []
    let matched = -1
    subtitleItems.forEach((item, index) => {
      // manualCleanup=true：重试重新挂源时视频轨道被清理，字幕轨需要保留并手动移除
      const element = player.addRemoteTextTrack({ kind: 'subtitles', srclang: 'zh', label: item.name, src: item.url }, true) as RemoteTrackElement
      added.push(element)
      if (matched < 0 && item.name.toLowerCase() === base) { element.track.mode = 'showing'; matched = index }
    })
    trackElementsRef.current = added
    setSelectedSubtitle(matched)
    return () => {
      trackElementsRef.current = []
      if (player.isDisposed()) return
      for (const element of added) { try { player.removeRemoteTextTrack(element) } catch { /* 销毁竞争时忽略 */ } }
    }
  }, [playerReady, subtitleItems, file.name])

  const changeSubtitle = (value: string) => {
    const index = Number(value)
    setSelectedSubtitle(index)
    const label = subtitleItems[index]?.name
    for (const element of trackElementsRef.current) element.track.mode = element.track.label === label ? 'showing' : 'disabled'
  }

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const WAITING_TEXT = '正在等待资源数据下载，就绪后自动开始播放…'

    const saveProgress = () => {
      const current = playerRef.current
      if (!current || current.isDisposed()) return
      const position = current.currentTime() ?? 0
      const duration = current.duration() ?? 0
      if (!Number.isFinite(position) || position < 1) return
      // 看完（≥98%）即清除记录，下次从头播放
      if (duration > 0 && position >= duration * 0.98) { void ipc.setProgress(infoHash, file.path, 0, 0); return }
      void ipc.setProgress(infoHash, file.path, position, duration)
    }

    const attach = (streamUrl: string) => {
      if (!active || !containerRef.current) return
      const element = document.createElement('video')
      element.className = 'video-js vjs-big-play-centered'
      element.setAttribute('playsinline', '')
      containerRef.current.replaceChildren(element)
      const source = { src: streamUrl, type: getMime(file.name) }
      const player = videojs(element, { controls: true, autoplay: false, preload: 'auto', fluid: true, responsive: true, sources: [source] })
      playerRef.current = player
      player.on('error', () => {
        if (!active) return
        const code = player.error()?.code
        // 数据未下载完整时 Chromium 报网络/源错误（2/4），等更多数据到位后重新挂载
        if ((code === 2 || code === 4) && !isUnsupported(file.name)) {
          setStatusText(WAITING_TEXT)
          setLoading(true)
          void (async () => {
            for (let attempt = 0; active && attempt < 100; attempt++) {
              await new Promise((resolve) => setTimeout(resolve, 3000))
              if (!active) return
              if (await probeStream(streamUrl, controller.signal) === 'ready') {
                if (!active) return
                player.src(source)
                player.load()
                return
              }
            }
            if (active) { setLoading(false); setError('等待数据超时，请确认任务仍在下载后重试') }
          })()
        } else {
          setLoading(false)
          setError(isUnsupported(file.name) ? `${file.name.slice(file.name.lastIndexOf('.'))} 容器无法在内置播放器中解码，建议寻找 MP4 / H.264 版本` : '当前格式或编码不受支持，建议使用 MP4 / H.264 资源')
        }
      })
      // 观看进度：节流保存 + 暂停时保存，元数据就绪后恢复上次位置
      player.on('timeupdate', () => { const now = Date.now(); if (now - lastSaveRef.current < 5000) return; lastSaveRef.current = now; saveProgress() })
      player.on('pause', saveProgress)
      player.one('loadedmetadata', () => {
        if (!active) return
        void (async () => {
          const progress = await ipc.getProgress(infoHash, file.path).catch(() => null)
          if (!active || !progress || player.isDisposed()) return
          const duration = player.duration() ?? progress.duration
          if (progress.position >= 5 && (!duration || progress.position < duration * 0.98)) {
            player.currentTime(progress.position)
            setResumeNotice(`已从 ${formatTime(progress.position)} 继续播放`)
            window.setTimeout(() => setResumeNotice(null), 3000)
          }
        })()
      })
      setPlayerReady((value) => value + 1)
      setLoading(false)
    }

    const init = async () => {
      try {
        const streamUrl = await ipc.getStreamUrl(infoHash, file.path)
        if (!active) return
        // 按需下载场景：开头数据可能还没写盘，探测就绪后再挂载，避免一次 404 就报错
        for (;;) {
          if (!active) return
          const state = await probeStream(streamUrl, controller.signal)
          if (!active) return
          if (state === 'ready') break
          if (state === 'failed') { setLoading(false); setError('媒体流服务异常，请返回后重试'); return }
          setStatusText(WAITING_TEXT)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        if (!active) return
        setStatusText('正在准备媒体流…')
        attach(streamUrl)
      } catch (reason) {
        if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : '播放器初始化失败') }
      }
    }
    void init()
    return () => {
      active = false
      controller.abort()
      try { saveProgress() } catch { /* 播放器已不可用 */ }
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [infoHash, file.path, file.name])

  return <div className="player-page"><header className="player-header"><button className="back-link" onClick={onBack}>← 返回媒体库</button><div className="player-heading"><span className={`file-icon ${file.type}`}>{file.type === 'audio' ? '♫' : '▶'}</span><div><h2>{file.name}</h2><p>{file.type === 'audio' ? '音频播放' : '视频播放'}</p></div></div>{subtitleItems.length > 0 && <label className="subtitle-picker"><span>CC</span><select value={selectedSubtitle} onChange={(event) => changeSubtitle(event.target.value)}><option value={-1}>关闭字幕</option>{subtitleItems.map((item, index) => <option key={item.url} value={index}>{item.name}</option>)}</select></label>}</header><div className="player-stage"><div ref={containerRef} className="player-container" />{loading && <div className="player-overlay"><div className="loading-spinner" /><span>{statusText}</span></div>}{error && <div className="player-overlay player-error"><span>{error}</span><button className="secondary-action" onClick={onBack}>返回媒体库</button></div>}{!loading && !error && resumeNotice && <div className="resume-toast">{resumeNotice}</div>}</div></div>
}
export default Player
