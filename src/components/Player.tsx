import React, { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import 'video.js/dist/video-js.css'
import { ipc } from '../services/ipc'
import type { TorrentFileInfo } from '../types'

interface PlayerProps { infoHash: string; file: TorrentFileInfo; onBack: () => void }

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
}
// Chromium 无法解码的常见容器：重试没有意义，直接提示
const UNSUPPORTED = ['.mkv', '.avi', '.wmv', '.flv', '.rmvb', '.ts']

function getMime(name: string) { return MIME[name.toLowerCase().slice(name.lastIndexOf('.'))] || 'application/octet-stream' }

function isUnsupported(name: string) { return UNSUPPORTED.includes(name.toLowerCase().slice(name.lastIndexOf('.'))) }

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

const Player: React.FC<PlayerProps> = ({ infoHash, file, onBack }) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<ReturnType<typeof videojs> | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusText, setStatusText] = useState('正在准备媒体流…')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const WAITING_TEXT = '正在等待资源数据下载，就绪后自动开始播放…'

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
    return () => { active = false; controller.abort(); playerRef.current?.dispose(); playerRef.current = null }
  }, [infoHash, file.path, file.name])

  return <div className="player-page"><header className="player-header"><button className="back-link" onClick={onBack}>← 返回媒体库</button><div className="player-heading"><span className={`file-icon ${file.type}`}>{file.type === 'audio' ? '♫' : '▶'}</span><div><h2>{file.name}</h2><p>{file.type === 'audio' ? '音频播放' : '视频播放'}</p></div></div></header><div className="player-stage"><div ref={containerRef} className="player-container" />{loading && <div className="player-overlay"><div className="loading-spinner" /><span>{statusText}</span></div>}{error && <div className="player-overlay player-error"><span>{error}</span><button className="secondary-action" onClick={onBack}>返回媒体库</button></div>}</div></div>
}
export default Player
