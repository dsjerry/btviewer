import React, { useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import type TextTrack from 'video.js/dist/types/tracks/text-track'
import 'video.js/dist/video-js.css'
import { ipc } from '../services/ipc'
import { srtToVtt } from '../services/subtitle'
import type { TorrentFileInfo } from '../types'

type VjsPlayer = ReturnType<typeof videojs>
// video.js 的 d.ts 不完整：漏掉了 .track（运行时存在）以及 TextTrack 的 mode/label，这里补齐类型
type SubtitleTrack = TextTrack & { mode: 'disabled' | 'hidden' | 'showing'; label: string }
type RemoteTrackElement = ReturnType<VjsPlayer['addRemoteTextTrack']> & { track: SubtitleTrack }
// 自定义控制条按钮（截图/录制）的最小接口；video.js 的 d.ts 对自定义组件支持不完整
interface VjsControlButton { controlText: (text: string) => void; addClass: (cls: string) => void; removeClass: (cls: string) => void }
type VjsControlBar = { addChild: (child: unknown, options?: unknown, index?: number) => unknown; children: () => unknown[]; getChild: (name: string) => unknown }

interface PlayerProps { infoHash: string; file: TorrentFileInfo; subtitles: TorrentFileInfo[]; playlist: TorrentFileInfo[]; onSelectFile: (file: TorrentFileInfo) => void; onBack: () => void }

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4'
}
// 控制条 UI 的中文文案（video.js 内置菜单默认是英文）
videojs.addLanguage('zh-CN', { Subtitles: '字幕', Captions: '字幕', 'subtitles off': '关闭字幕', 'captions off': '关闭字幕', off: '关闭', 'Restore Language': '恢复默认语言' })
// Chromium 无法解码的常见容器：重试没有意义，直接提示
const UNSUPPORTED = ['.mkv', '.avi', '.wmv', '.flv', '.rmvb', '.ts']

function getMime(name: string) { return MIME[name.toLowerCase().slice(name.lastIndexOf('.'))] || 'application/octet-stream' }

function isUnsupported(name: string) { return UNSUPPORTED.includes(name.toLowerCase().slice(name.lastIndexOf('.'))) }

// 音量/倍速全局记忆：跨任务、跨集沿用上次的设置
const VOLUME_KEY = 'btviewer-volume'
const RATE_KEY = 'btviewer-rate'
const savedVolume = () => { const value = Number(localStorage.getItem(VOLUME_KEY)); return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1 }
const savedRate = () => { const value = Number(localStorage.getItem(RATE_KEY)); return [0.5, 0.75, 1, 1.25, 1.5, 2].includes(value) ? value : 1 }

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

const Player: React.FC<PlayerProps> = ({ infoHash, file, subtitles, playlist, onSelectFile, onBack }) => {
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
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('btviewer-autoplay') !== 'off')
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const localSubtitleUrlsRef = useRef<string[]>([])
  // 新加载的本地字幕默认直接显示：挂载轨的副作用读取该名字优先匹配
  const pendingLocalSubtitleRef = useRef<string | null>(null)
  // 截屏与片段录制
  const [toast, setToast] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const toastTimerRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunksRef = useRef<Blob[]>([])
  const recordTimerRef = useRef(0)
  const recordButtonRef = useRef<VjsControlButton | null>(null)

  // 播完连播需要读取最新值：列表/回调随任务状态刷新重建，用 ref 提供给一次性注册的事件
  const playlistRef = useRef(playlist); playlistRef.current = playlist
  const fileRef = useRef(file); fileRef.current = file
  const onSelectFileRef = useRef(onSelectFile); onSelectFileRef.current = onSelectFile
  const autoPlayRef = useRef(autoPlay); autoPlayRef.current = autoPlay

  const currentIndex = playlist.findIndex((item) => item.path === file.path)
  const playIndex = (index: number) => { const target = playlist[index]; if (target) onSelectFile(target) }
  const toggleAutoPlay = () => setAutoPlay((value) => { localStorage.setItem('btviewer-autoplay', value ? 'off' : 'on'); return !value })

  // 任务状态每秒刷新会让 files 数组身份不断变化，用路径签名避免重复请求字幕 URL
  const subtitleKey = subtitles.map((item) => item.path).join('\n')

  // 组件卸载时释放本地字幕的 blob URL 与计时器
  useEffect(() => () => {
    for (const url of localSubtitleUrlsRef.current) URL.revokeObjectURL(url)
    window.clearTimeout(toastTimerRef.current)
    window.clearInterval(recordTimerRef.current)
  }, [])

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
    const pendingName = pendingLocalSubtitleRef.current?.toLowerCase()
    subtitleItems.forEach((item, index) => {
      // manualCleanup=true：重试重新挂源时视频轨道被清理，字幕轨需要保留并手动移除
      const element = player.addRemoteTextTrack({ kind: 'subtitles', srclang: 'zh', label: item.name, src: item.url }, true) as RemoteTrackElement
      added.push(element)
      const isMatch = pendingName ? item.name.toLowerCase() === pendingName : item.name.toLowerCase() === base
      if (matched < 0 && isMatch) { element.track.mode = 'showing'; matched = index }
    })
    pendingLocalSubtitleRef.current = null
    trackElementsRef.current = added
    return () => {
      trackElementsRef.current = []
      if (player.isDisposed()) return
      for (const element of added) { try { player.removeRemoteTextTrack(element) } catch { /* 销毁竞争时忽略 */ } }
    }
  }, [playerReady, subtitleItems, file.name])

  // 本地字幕：读取 srt/vtt 文本（srt 转成 vtt），blob URL 走与远端字幕相同的挂载通道
  const loadLocalSubtitle = (files: FileList | null) => {
    const chosen = files?.[0]
    if (!chosen) return
    void (async () => {
      try {
        const text = await chosen.text()
        const vtt = /\.srt$/i.test(chosen.name) ? srtToVtt(text) : text
        const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
        localSubtitleUrlsRef.current.push(url)
        const name = chosen.name.replace(/\.[^.]+$/, '')
        pendingLocalSubtitleRef.current = name
        setSubtitleItems((items) => items.some((item) => item.name === name) ? items : [...items, { name, url }])
      } catch { /* 读取失败静默忽略 */ }
    })()
  }

  const showToast = (text: string | null) => {
    window.clearTimeout(toastTimerRef.current)
    setToast(text)
    if (text) toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }

  const videoElement = () => (containerRef.current?.querySelector('video') ?? null) as HTMLVideoElement | null

  const stamp = () => {
    const now = new Date()
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  }

  // 截屏：当前帧画到 canvas 导出 PNG，走系统保存对话框
  const snapshot = async () => {
    const video = videoElement()
    if (!video || !video.videoWidth) { showToast('当前没有可截取的画面'); return }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      const result = await ipc.saveMediaFile(`${file.name.replace(/\.[^.]+$/, '')}_${stamp()}.png`, canvas.toDataURL('image/png'))
      showToast(result.success ? `截图已保存：${result.data}` : result.canceled ? null : result.error || '保存截图失败')
    } catch { showToast('截屏失败：画面尚未就绪') }
  }

  // 片段录制：实时把当前播放录成 webm（captureStream 只取媒体本身，不含控制条）
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }

  const startRecording = () => {
    const video = videoElement()
    // TS 的 DOM 类型库还没有 captureStream，运行时 Chromium 一直支持
    const capture = (video as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null)?.captureStream?.bind(video)
    if (!video || !video.videoWidth || typeof capture !== 'function') { showToast('当前画面不支持录制'); return }
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = new MediaRecorder(capture(), mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined)
    recordChunksRef.current = []
    recorder.ondataavailable = (event) => { if (event.data.size) recordChunksRef.current.push(event.data) }
    recorder.onstop = () => {
      window.clearInterval(recordTimerRef.current)
      setRecording(false)
      recorderRef.current = null
      const blob = new Blob(recordChunksRef.current, { type: recorder.mimeType || 'video/webm' })
      recordChunksRef.current = []
      if (!blob.size) { showToast('没有录到内容'); return }
      void (async () => {
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('读取录制数据失败'))
            reader.readAsDataURL(blob)
          })
          const result = await ipc.saveMediaFile(`${file.name.replace(/\.[^.]+$/, '')}_${stamp()}.webm`, dataUrl)
          showToast(result.success ? `录制已保存：${result.data}` : result.canceled ? null : result.error || '保存录制失败')
        } catch (error) { showToast(error instanceof Error ? error.message : '保存录制失败') }
      })()
    }
    recorder.start(1000)
    recorderRef.current = recorder
    setRecordSeconds(0)
    setRecording(true)
    recordTimerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
  }

  // 回调经 ref 传给控制条按钮，保证按钮拿到的一直是最新处理函数
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot
  const recordToggleRef = useRef(startRecording); recordToggleRef.current = recording ? stopRecording : startRecording

  // 录制状态同步到控制条按钮（红点 + 文案）
  useEffect(() => {
    const button = recordButtonRef.current
    if (!button) return
    if (recording) { button.addClass('vjs-btv-recording'); button.controlText('停止录制并保存') } else { button.removeClass('vjs-btv-recording'); button.controlText('把当前播放实时录成 webm 片段') }
  }, [recording, playerReady])

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
      // 流服务带 CORS 头：声明 anonymous 后 canvas 不被污染，截屏/录制才能拿到画面
      element.setAttribute('crossorigin', 'anonymous')
      containerRef.current.replaceChildren(element)
      const source = { src: streamUrl, type: getMime(file.name) }
      // playbackRates 会让 video.js 在控制条自动挂上倍速菜单按钮
      const player = videojs(element, { controls: true, autoplay: false, preload: 'auto', fluid: true, responsive: true, language: 'zh-CN', playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2], sources: [source] })
      playerRef.current = player
      let lastVolumeSave = 0
      // 音量/倍速变化时持久化（拖动音量条会密集触发，做节流）
      player.on('volumechange', () => { const now = Date.now(); if (now - lastVolumeSave < 400) return; lastVolumeSave = now; localStorage.setItem(VOLUME_KEY, String(player.volume() ?? 1)) })
      player.on('ratechange', () => { if (!player.isDisposed()) localStorage.setItem(RATE_KEY, String(player.playbackRate() ?? 1)) })
      // 字幕/截图/录制按钮融入控制条（插在全屏按钮前），随控制条一起自动隐藏
      try {
        const VjsButton = videojs.getComponent('Button') as unknown as new (player: VjsPlayer, options?: { onClick?: () => void }) => VjsControlButton
        class BtvControlButton extends VjsButton {
          handleClick() { (this as unknown as { options_: { onClick?: () => void } }).options_.onClick?.() }
        }
        const bar = (player as unknown as { controlBar: VjsControlBar }).controlBar
        const addBeforeFullscreen = (button: unknown) => {
          const index = bar.children().indexOf(bar.getChild('fullscreenToggle'))
          bar.addChild(button, undefined, index < 0 ? bar.children().length : index)
        }
        // CC：video.js 内置字幕菜单，自动列出所有字幕轨（含后加载的本地字幕）
        const SubsCapsButton = videojs.getComponent('SubsCapsButton') as unknown as (new (player: VjsPlayer) => VjsControlButton) | undefined
        if (SubsCapsButton) addBeforeFullscreen(new SubsCapsButton(player))
        if (file.type !== 'audio') {
          const loadSubButton = new BtvControlButton(player, { onClick: () => subtitleInputRef.current?.click() })
          loadSubButton.controlText('加载本地 srt / vtt 字幕')
          loadSubButton.addClass('vjs-btv-loadsub')
          addBeforeFullscreen(loadSubButton)
        }
        const snapshotButton = new BtvControlButton(player, { onClick: () => snapshotRef.current() })
        snapshotButton.controlText('截取当前画面并保存为图片')
        snapshotButton.addClass('vjs-btv-snapshot')
        addBeforeFullscreen(snapshotButton)
        const recordButton = new BtvControlButton(player, { onClick: () => recordToggleRef.current() })
        recordButton.controlText('把当前播放实时录成 webm 片段')
        recordButton.addClass('vjs-btv-record')
        recordButtonRef.current = recordButton
        addBeforeFullscreen(recordButton)
      } catch { /* 控制条结构变化时按钮缺失不影响播放 */ }
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
        // 先恢复全局音量/倍速记忆，再处理续播定位
        if (!player.isDisposed()) { player.volume(savedVolume()); player.playbackRate(savedRate()) }
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
      // 播完自动连播：切到播放列表中的下一个媒体（新文件未就绪时由探测重试逻辑接管）
      player.on('ended', () => {
        if (!active || !autoPlayRef.current) return
        const list = playlistRef.current
        const index = list.findIndex((item) => item.path === fileRef.current.path)
        if (index >= 0 && index < list.length - 1) onSelectFileRef.current(list[index + 1])
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
      // 切集/返回时若还在录制：直接丢弃本次录制（跨文件的录制没有意义）
      try { const recorder = recorderRef.current; if (recorder && recorder.state === 'recording') { recorder.onstop = null; recorder.stop() } } catch { /* 忽略 */ }
      recorderRef.current = null
      window.clearInterval(recordTimerRef.current)
      setRecording(false)
      recordButtonRef.current = null
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [infoHash, file.path, file.name])

  return <div className="player-page"><header className="player-header"><button className="back-link" onClick={onBack}>← 返回媒体库</button><div className="player-heading"><span className={`file-icon ${file.type}`}>{file.type === 'audio' ? '♫' : '▶'}</span><div><h2>{file.name}</h2><p>{file.type === 'audio' ? '音频播放' : '视频播放'}</p></div></div>{playlist.length > 1 && <div className="playlist-controls"><button className="playlist-button" disabled={currentIndex <= 0} onClick={() => playIndex(currentIndex - 1)} title="上一集">⏮</button><span className="playlist-index">{currentIndex + 1} / {playlist.length}</span><button className="playlist-button" disabled={currentIndex < 0 || currentIndex >= playlist.length - 1} onClick={() => playIndex(currentIndex + 1)} title="下一集">⏭</button><button className={`playlist-button autoplay-toggle ${autoPlay ? 'is-on' : ''}`} onClick={toggleAutoPlay} title="播放结束后自动播放下一集">连播{autoPlay ? '开' : '关'}</button></div>}</header><input ref={subtitleInputRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(event) => { loadLocalSubtitle(event.target.files); event.target.value = '' }} /><div className="player-stage"><div ref={containerRef} className="player-container" />{loading && <div className="player-overlay"><div className="loading-spinner" /><span>{statusText}</span></div>}{error && <div className="player-overlay player-error"><span>{error}</span><button className="secondary-action" onClick={onBack}>返回媒体库</button></div>}{!loading && !error && (resumeNotice || toast) && <div className="resume-toast">{toast || resumeNotice}</div>}{recording && <div className="record-badge"><span />REC {formatTime(recordSeconds)}</div>}</div></div>
}
export default Player
