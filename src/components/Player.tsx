import React, { useCallback, useEffect, useRef, useState } from 'react'
import videojs from 'video.js'
import type TextTrack from 'video.js/dist/types/tracks/text-track'
import 'video.js/dist/video-js.css'
import { ipc } from '../services/ipc'
import { t } from '../services/i18n'
import { srtToVtt } from '../services/subtitle'
import { episodeLabel, parseEpisode } from '../services/episode'
import { pickAutoSubtitle, rankSubtitles, subtitleLanguage, type SubtitleCandidate } from '../services/subtitle-match'
import { formatMark, parseMarksStore, skipDecision, updateMarksStore } from '../services/player-extras'
import { seriesKey } from '../services/episode'
// 播放位置 → 字节偏移的换算与主进程共用同一实现（纯函数，无 Node 依赖）
import { byteOffsetFor } from '../../electron/stream-priority'
import type { CompatAudioTrack, PlaylistEntry, SkipMarks, TorrentFileInfo } from '../types'

type VjsPlayer = ReturnType<typeof videojs>
// video.js 的 d.ts 不完整：漏掉了 .track（运行时存在）以及 TextTrack 的 mode/label，这里补齐类型
type SubtitleTrack = TextTrack & { mode: 'disabled' | 'hidden' | 'showing'; label: string }
type RemoteTrackElement = ReturnType<VjsPlayer['addRemoteTextTrack']> & { track: SubtitleTrack }
// 自定义控制条按钮（截图/录制）的最小接口；video.js 的 d.ts 对自定义组件支持不完整
interface VjsControlButton { controlText: (text: string) => void; addClass: (cls: string) => void; removeClass: (cls: string) => void }
type VjsControlBar = { addChild: (child: unknown, options?: unknown, index?: number) => unknown; children: () => unknown[]; getChild: (name: string) => unknown }

interface PlayerProps { infoHash: string; file: TorrentFileInfo; subtitles: TorrentFileInfo[]; playlist: PlaylistEntry[]; onSelectFile: (entry: PlaylistEntry) => void; onBack: () => void }

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
  const [statusText, setStatusText] = useState(t('player.preparing'))
  const [error, setError] = useState<string | null>(null)
  const [resumeNotice, setResumeNotice] = useState<string | null>(null)
  const [subtitleItems, setSubtitleItems] = useState<Array<SubtitleCandidate & { url: string }>>([])
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem('btviewer-autoplay') !== 'off')
  const subtitleInputRef = useRef<HTMLInputElement>(null)
  const localSubtitleUrlsRef = useRef<string[]>([])
  // 新加载的本地字幕默认直接显示：挂载轨的副作用读取该名字优先匹配
  const pendingLocalSubtitleRef = useRef<string | null>(null)
  // 字幕面板（B5）：轨道切换、字号/位置/背景、延迟
  const [subtitleOpen, setSubtitleOpen] = useState(false)
  const [activeTrack, setActiveTrack] = useState(-1)
  const [cueDelay, setCueDelay] = useState(0)
  const cueDelayRef = useRef(0)
  const [cueStyle, setCueStyle] = useState(() => ({
    scale: Number(localStorage.getItem('btviewer-cue-scale')) || 1,
    bottom: Number(localStorage.getItem('btviewer-cue-bottom')) || 8,
    bg: Number(localStorage.getItem('btviewer-cue-bg')) || 45
  }))
  // 播放器增强（B6）：片头片尾标记（按剧集记忆）、自动跳过、快捷键帮助、画中画
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [skipEnabled, setSkipEnabled] = useState(() => localStorage.getItem('btviewer-skip-enabled') !== 'off')
  const [marksStore, setMarksStore] = useState<Record<string, SkipMarks>>(() => parseMarksStore(localStorage.getItem('btviewer-skip-marks')))
  const skipEnabledRef = useRef(skipEnabled); skipEnabledRef.current = skipEnabled
  const marksRef = useRef(marksStore); marksRef.current = marksStore
  const lastSkipRef = useRef<{ action: string; at: number }>({ action: '', at: 0 })
  // 统一的提示条出口：播放器事件回调里也要用，所以在状态声明后就定义
  const pushToast = (text: string) => {
    setToast(text)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }
  const seriesKeyOf = (name: string) => seriesKey(name) || name.toLowerCase()
  const showMarks = marksStore[seriesKeyOf(file.name)] || {}
  // 截屏与片段录制
  const [toast, setToast] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const toastTimerRef = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordSessionRef = useRef<string | null>(null)
  const recordTimerRef = useRef(0)
  const recordButtonRef = useRef<VjsControlButton | null>(null)
  // 兼容播放（B1）：内置播放器解不了的编码，用 ffmpeg 生成可播放副本
  const [compat, setCompat] = useState<{ id: string | null; phase: 'idle' | 'preparing' | 'running' | 'error'; percent: number; message: string; container: 'mp4' | 'webm' }>({ id: null, phase: 'idle', percent: 0, message: '', container: 'mp4' })
  const compatRef = useRef(compat); compatRef.current = compat

  // 播完连播需要读取最新值：列表/回调随任务状态刷新重建，用 ref 提供给一次性注册的事件
  const playlistRef = useRef(playlist); playlistRef.current = playlist
  const fileRef = useRef(file); fileRef.current = file
  const onSelectFileRef = useRef(onSelectFile); onSelectFileRef.current = onSelectFile
  const autoPlayRef = useRef(autoPlay); autoPlayRef.current = autoPlay

  const currentIndex = playlist.findIndex((item) => item.infoHash === infoHash && item.file.path === file.path)
  const playIndex = (index: number) => { const target = playlist[index]; if (target) onSelectFile(target) }
  // 剧集标签（B4）：播放列表跨任务聚合时用来显示「S01E02 · 3 / 24」
  const episodeTag = parseEpisode(file.name)
  const nextEntry = currentIndex >= 0 ? playlist[currentIndex + 1] : undefined
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
      // 先按「属于当前视频」的程度排序（同名 > 同集 > 整季包 > 其它），再取 URL
      const ranked = rankSubtitles(file.name, subtitles)
      const items: Array<SubtitleCandidate & { url: string }> = []
      for (const candidate of ranked) {
        try { items.push({ ...candidate, url: await ipc.getSubtitleUrl(infoHash, candidate.path) }) } catch { /* 单个字幕不可用不影响其它 */ }
      }
      if (active) setSubtitleItems(items)
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoHash, subtitleKey, file.name])

  // 字幕轨挂载：等播放器与字幕 URL 都就绪后执行；按匹配度自动选中首选（本地加载的字幕优先）
  useEffect(() => {
    const player = playerRef.current
    if (!playerReady || !player || player.isDisposed() || !subtitleItems.length) return
    const added: RemoteTrackElement[] = []
    // 排序已由 rankSubtitles 给出：本地加载的字幕优先，其次第一条匹配度足够的
    const pendingName = pendingLocalSubtitleRef.current?.toLowerCase()
    const auto = pendingName ? subtitleItems.findIndex((item) => item.name.toLowerCase() === pendingName) : (() => {
      const best = pickAutoSubtitle(subtitleItems)
      return best ? subtitleItems.findIndex((item) => item.path === best.path) : -1
    })()
    subtitleItems.forEach((item, index) => {
      // manualCleanup=true：重试重新挂源时视频轨道被清理，字幕轨需要保留并手动移除
      const element = player.addRemoteTextTrack({ kind: 'subtitles', srclang: 'zh', label: item.language ? `${item.language} · ${item.name}` : item.name, src: item.url }, true) as RemoteTrackElement
      added.push(element)
      if (index === auto) element.track.mode = 'showing'
    })
    pendingLocalSubtitleRef.current = null
    trackElementsRef.current = added
    setActiveTrack(auto)
    // 轨内容异步加载，稍后再套用延迟
    if (cueDelayRef.current) window.setTimeout(() => applyCueDelay(cueDelayRef.current), 600)
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
        // 本地字幕排在首位并标记为满分匹配，自动选中逻辑会优先用它
        setSubtitleItems((items) => [{ name, path: `local:${name}`, url, language: subtitleLanguage(chosen.name), score: 100 }, ...items.filter((item) => item.name !== name)])
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
    if (!video || !video.videoWidth) { showToast(t('player.noFrame')); return }
    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d')?.drawImage(video, 0, 0)
      const result = await ipc.saveMediaFile(`${file.name.replace(/\.[^.]+$/, '')}_${stamp()}.png`, canvas.toDataURL('image/png'))
      showToast(result.success ? t('player.snapshotSaved', { path: result.data ?? '' }) : result.canceled ? null : result.error || t('player.snapshotFailed'))
    } catch { showToast(t('player.snapshotNotReady')) }
  }

  // 片段录制：开始前先选保存路径，录制中分片流式写盘（内存不随时长增长）；
  // captureStream 只取媒体本身，不含控制条
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }

  const startRecording = async () => {
    const video = videoElement()
    // TS 的 DOM 类型库还没有 captureStream，运行时 Chromium 一直支持
    const capture = (video as (HTMLVideoElement & { captureStream?: () => MediaStream }) | null)?.captureStream?.bind(video)
    if (!video || !video.videoWidth || typeof capture !== 'function') { showToast(t('player.recordUnsupported')); return }
    const begin = await ipc.recordBegin(`${file.name.replace(/\.[^.]+$/, '')}_${stamp()}.webm`)
    if (!begin.success || !begin.data) { showToast(begin.canceled ? null : begin.error || t('player.recordBeginFailed')); return }
    const session = begin.data
    const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type))
    const recorder = new MediaRecorder(capture(), mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined)
    recorder.ondataavailable = (event) => {
      if (!event.data.size) return
      void event.data.arrayBuffer().then((buffer) => ipc.recordAppend(session.id, new Uint8Array(buffer))).catch(() => undefined)
    }
    recorder.onstop = () => {
      window.clearInterval(recordTimerRef.current)
      setRecording(false)
      recorderRef.current = null
      recordSessionRef.current = null
      void ipc.recordEnd(session.id).then((result) => showToast(result.success ? t('player.recordSaved', { path: result.data ?? '' }) : result.error || t('player.recordSaveFailed'))).catch(() => showToast(t('player.recordSaveFailed')))
    }
    recorder.start(1000)
    recorderRef.current = recorder
    recordSessionRef.current = session.id
    setRecordSeconds(0)
    setRecording(true)
    recordTimerRef.current = window.setInterval(() => setRecordSeconds((value) => value + 1), 1000)
  }

  // 回调经 ref 传给控制条按钮，保证按钮拿到的一直是最新处理函数
  const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot
  const recordToggleRef = useRef<() => void>(() => undefined); recordToggleRef.current = recording ? stopRecording : () => void startRecording()

  // 录制状态同步到控制条按钮（红点 + 文案）
  useEffect(() => {
    const button = recordButtonRef.current
    if (!button) return
    if (recording) { button.addClass('vjs-btv-recording'); button.controlText(t('player.recordStop')) } else { button.removeClass('vjs-btv-recording'); button.controlText(t('player.recordStart')) }
  }, [recording, playerReady])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const WAITING_TEXT = t('player.waitingData')

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

    // 边下边播：把「即将播放的位置」告诉下载引擎做分片优先，减少起播/拖动等待。
    // 未下载完才有意义（文件已完整时跳过，避免无用的 RPC 与日志）；失败静默，只影响速度不影响播放。
    let lastPrioritizeAt = 0
    const prioritizeStream = (position: number, duration: number) => {
      const current = fileRef.current
      if (!current || !current.size || current.completed >= current.size) return
      const now = Date.now()
      if (now - lastPrioritizeAt < 4000) return
      lastPrioritizeAt = now
      void ipc.prioritizeStream(infoHash, byteOffsetFor(position, duration, current.size)).catch(() => undefined)
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
          loadSubButton.controlText(t('player.loadSubtitleTitle'))
          loadSubButton.addClass('vjs-btv-loadsub')
          addBeforeFullscreen(loadSubButton)
        }
        const snapshotButton = new BtvControlButton(player, { onClick: () => snapshotRef.current() })
        snapshotButton.controlText(t('player.snapshotTitle'))
        snapshotButton.addClass('vjs-btv-snapshot')
        addBeforeFullscreen(snapshotButton)
        const recordButton = new BtvControlButton(player, { onClick: () => recordToggleRef.current() })
        recordButton.controlText(t('player.recordStart'))
        recordButton.addClass('vjs-btv-record')
        recordButtonRef.current = recordButton
        addBeforeFullscreen(recordButton)
        // 画中画：浏览器不支持时按钮不出现
        if (document.pictureInPictureEnabled) {
          const pipButton = new BtvControlButton(player, { onClick: () => void togglePictureInPicture() })
          pipButton.controlText(t('player.shortcutPip'))
          pipButton.addClass('vjs-btv-pip')
          addBeforeFullscreen(pipButton)
        }
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
            if (active) { setLoading(false); setError(t('player.waitTimeout')) }
          })()
        } else {
          setLoading(false)
          setError(isUnsupported(file.name) ? `${file.name.slice(file.name.lastIndexOf('.'))} 容器无法在内置播放器中解码，建议寻找 MP4 / H.264 版本` : t('player.unsupportedCodec'))
        }
      })
      // 观看进度：节流保存 + 暂停时保存，元数据就绪后恢复上次位置
      player.on('timeupdate', () => { const now = Date.now(); if (now - lastSaveRef.current < 5000) return; lastSaveRef.current = now; saveProgress() })
      // 片头/片尾自动跳过（B6）：标记按剧集记忆，同剧各集共用；同一次跳过 3 秒内不重复触发
      player.on('timeupdate', () => {
        const key = seriesKeyOf(fileRef.current.name)
        const decision = skipDecision(player.currentTime() ?? 0, player.duration() ?? 0, marksRef.current[key] || {}, skipEnabledRef.current)
        if (!decision) return
        const guard = lastSkipRef.current
        if (guard.action === decision.action && Date.now() - guard.at < 3000) return
        lastSkipRef.current = { action: decision.action, at: Date.now() }
        if (decision.action === 'intro') { player.currentTime(decision.target); pushToast(decision.label); return }
        // 片尾：能连播就切下一集，否则退到片尾前 0.5 秒
        const list = playlistRef.current
        const index = list.findIndex((item) => item.infoHash === infoHash && item.file.path === fileRef.current.path)
        if (autoPlayRef.current && index >= 0 && index < list.length - 1) onSelectFileRef.current(list[index + 1])
        else player.currentTime(Math.max(0, decision.target - 0.5))
      })
      player.on('pause', saveProgress)
      // 拖动/跳转后立即请求优先下载目标位置（首次播放由 init 里的 head 优先覆盖）
      player.on('seeked', () => { if (active) prioritizeStream(player.currentTime() ?? 0, player.duration() ?? 0) })
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
        const index = list.findIndex((item) => item.infoHash === infoHash && item.file.path === fileRef.current.path)
        if (index >= 0 && index < list.length - 1) onSelectFileRef.current(list[index + 1])
      })
      setPlayerReady((value) => value + 1)
      setLoading(false)
    }

    const init = async () => {
      try {
        const streamUrl = await ipc.getStreamUrl(infoHash, file.path)
        if (!active) return
        // 起播优先：先让引擎优先下载文件头尾（MP4 的 moov 可能在尾部），再等数据就绪
        prioritizeStream(0, 0)
        // 按需下载场景：开头数据可能还没写盘，探测就绪后再挂载，避免一次 404 就报错
        for (;;) {
          if (!active) return
          const state = await probeStream(streamUrl, controller.signal)
          if (!active) return
          if (state === 'ready') break
          if (state === 'failed') { setLoading(false); setError(t('player.streamError')); return }
          setStatusText(WAITING_TEXT)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
        if (!active) return
        setStatusText(t('player.preparing'))
        attach(streamUrl)
      } catch (reason) {
        if (active) { setLoading(false); setError(reason instanceof Error ? reason.message : t('player.initFailed')) }
      }
    }
    void init()
    return () => {
      active = false
      controller.abort()
      try { saveProgress() } catch { /* 播放器已不可用 */ }
      // 切集/返回时若还在录制：中止本次录制并删除半成品文件（跨文件的录制没有意义）
      try { const recorder = recorderRef.current; if (recorder && recorder.state === 'recording') { recorder.onstop = null; recorder.stop() } } catch { /* 忽略 */ }
      recorderRef.current = null
      window.clearInterval(recordTimerRef.current)
      setRecording(false)
      if (recordSessionRef.current) { void ipc.recordAbort(recordSessionRef.current).catch(() => undefined); recordSessionRef.current = null }
      recordButtonRef.current = null
      playerRef.current?.dispose()
      playerRef.current = null
    }
  }, [infoHash, file.path, file.name])

  // 兼容播放：转码完成后把播放器源换成 /compat/<id>（同一套 Range 流服务，可拖动）
  const loadCompatSource = useCallback(async (id: string) => {
    const result = await ipc.compatUrl(id).catch(() => null)
    if (!result?.success || !result.data) {
      setCompat((prev) => ({ ...prev, phase: 'error', percent: 0, message: result?.error || t('player.noCompatUrl') }))
      return
    }
    const container = compatRef.current.container
    setCompat((prev) => ({ ...prev, phase: 'idle', percent: 100 }))
    setLoading(false)
    const player = playerRef.current
    if (player && !player.isDisposed()) {
      player.src({ src: result.data, type: container === 'webm' ? 'video/webm' : 'video/mp4' })
      player.load()
      void player.play()?.catch(() => undefined)
    }
    setToast(t('player.compatSwitched'))
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3500)
  }, [])

  useEffect(() => {
    try {
      return ipc.onCompatProgress((event) => {
        const current = compatRef.current
        if (!current.id || current.id !== event.id) return
        if (event.phase === 'running') setCompat((prev) => ({ ...prev, phase: 'running', percent: event.percent }))
        else if (event.phase === 'done') void loadCompatSource(event.id)
        else setCompat((prev) => ({ ...prev, phase: 'error', percent: 0, message: event.message || t('player.transcodeFailed') }))
      })
    } catch { return () => undefined }
  }, [loadCompatSource])

  // 先分析（编码/原因/体积）让用户确认，再真正开跑；不会在没有 ffmpeg 时静默失败
  const startCompatPlayback = async () => {
    setToast(null)
    const plan = await ipc.compatPlan(infoHash, file.path, audioIndex).catch(() => null)
    if (!plan?.success || !plan.data) {
      setCompat({ id: null, phase: 'error', percent: 0, message: plan?.error || t('player.analyzeFailed'), container: 'mp4' })
      return
    }
    const { available, mode, reason, sizeBytes, audioTracks: probed } = plan.data
    if (probed?.length) setAudioTracks(probed)
    if (!available) {
      setCompat({ id: null, phase: 'error', percent: 0, message: reason, container: 'mp4' })
      return
    }
    const modeText = mode === 'copy' ? t('player.modeCopy') : mode === 'audio' ? t('player.modeAudio') : t('player.modeVideo')
    const sizeText = sizeBytes ? `${(sizeBytes / 1024 ** 3).toFixed(2)} GB` : t('player.unknownSize')
    if (!window.confirm(`兼容播放：${reason}\n方式：${modeText}\n将在下载目录的 .btviewer-compat 下生成约 ${sizeText} 的临时副本（可随时删除）。\n\n继续？`)) return
    setCompat({ id: null, phase: 'preparing', percent: 0, message: t('player.startingFfmpeg', { mode: modeText }), container: 'mp4' })
    const started = await ipc.compatStart(infoHash, file.path, audioIndex).catch(() => null)
    if (!started?.success || !started.data) {
      setCompat({ id: null, phase: 'error', percent: 0, message: started?.error || t('player.compatStartFailed'), container: 'mp4' })
      return
    }
    setError(null)
    setCompat({ id: started.data.id, phase: 'running', percent: 0, message: modeText, container: started.data.container })
  }

  const cancelCompatPlayback = () => {
    const id = compatRef.current.id
    if (id) void ipc.compatCancel(id).catch(() => undefined)
    setCompat({ id: null, phase: 'idle', percent: 0, message: '', container: 'mp4' })
  }

  // ── 字幕面板（B5）────────────────────────────────────────────
  // 字幕延迟：直接平移 cue 时间轴（Chromium 的 VTTCue 允许写 startTime/endTime，原始时间记在 cue 上）
  const applyCueDelay = (offset: number) => {
    const player = playerRef.current
    if (!player || player.isDisposed()) return
    const tracks = player.textTracks() as unknown as ArrayLike<{ cues: unknown } | undefined>
    for (let i = 0; i < tracks.length; i++) {
      const cues = tracks[i]?.cues as Array<{ startTime: number; endTime: number } & { __origin?: [number, number] }> | null | undefined
      if (!cues) continue
      for (const cue of Array.from(cues)) {
        if (!cue.__origin) cue.__origin = [cue.startTime, cue.endTime]
        const [start, end] = cue.__origin
        cue.startTime = Math.max(0, start + offset)
        cue.endTime = Math.max(0.05, end + offset)
      }
    }
  }

  const changeDelay = (delta: number) => {
    const next = Math.round(Math.max(-30, Math.min(30, cueDelayRef.current + delta)) * 10) / 10
    cueDelayRef.current = next
    setCueDelay(next)
    applyCueDelay(next)
  }

  const showTrack = (index: number) => {
    const player = playerRef.current
    if (player && !player.isDisposed()) {
      trackElementsRef.current.forEach((element, i) => { try { element.track.mode = i === index ? 'showing' : 'disabled' } catch { /* 轨已被移除 */ } })
    }
    setActiveTrack(index)
    if (cueDelayRef.current) window.setTimeout(() => applyCueDelay(cueDelayRef.current), 60)
  }

  // 样式通过 CSS 变量作用在 .player-stage 上：::cue 与 video.js 自绘 cue 都读同一组变量
  const updateCueStyle = (patch: Partial<{ scale: number; bottom: number; bg: number }>) => {
    setCueStyle((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem('btviewer-cue-scale', String(next.scale))
      localStorage.setItem('btviewer-cue-bottom', String(next.bottom))
      localStorage.setItem('btviewer-cue-bg', String(next.bg))
      return next
    })
  }

  // ── 片头片尾与画中画（B6）──────────────────────────────────────
  const saveMarks = (key: string, marks: SkipMarks) => {
    setMarksStore((current) => {
      const next = updateMarksStore(current, key, marks)
      localStorage.setItem('btviewer-skip-marks', JSON.stringify(next))
      return next
    })
  }

  // 标记以「当前播放位置」为准：片头结束＝现在跳过片头；片尾开始＝现在开始跳过
  const markCurrent = (kind: 'intro' | 'outro') => {
    const player = playerRef.current
    if (!player || player.isDisposed()) return
    const position = Math.round(player.currentTime() ?? 0)
    if (position < 1) { pushToast(t('player.markFirst')); return }
    const key = seriesKeyOf(fileRef.current.name)
    const current = marksRef.current[key] || {}
    const next = kind === 'intro' ? { ...current, introEnd: position } : { ...current, outroStart: position }
    const clean = updateMarksStore({ [key]: current }, key, next)[key] || {}
    saveMarks(key, clean)
    pushToast(kind === 'intro' ? `片头结束已标记在 ${formatMark(position)}` : `片尾开始已标记在 ${formatMark(position)}（同剧各集共用）`)
  }

  const clearMarks = () => { saveMarks(seriesKeyOf(fileRef.current.name), {}); pushToast(t('player.marksCleared')) }

  const toggleSkip = () => {
    setSkipEnabled((value) => {
      localStorage.setItem('btviewer-skip-enabled', value ? 'off' : 'on')
      return !value
    })
  }

  const togglePictureInPicture = async () => {
    const video = containerRef.current?.querySelector('video')
    if (!video) return
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.requestPictureInPicture()
    } catch { /* 无用户手势或系统不支持时忽略 */ }
  }

  // 快捷键（B6）：p 画中画 / i 标记片头结束 / o 标记片尾开始 / ? 帮助。
  // 回调经 ref 转发，保证监听只注册一次也能拿到最新的状态与闭包。
  const markCurrentRef = useRef(markCurrent); markCurrentRef.current = markCurrent
  const pipRef = useRef(togglePictureInPicture); pipRef.current = togglePictureInPicture
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'p') { event.preventDefault(); void pipRef.current() }
      else if (key === 'i') { event.preventDefault(); markCurrentRef.current('intro') }
      else if (key === 'o') { event.preventDefault(); markCurrentRef.current('outro') }
      else if (event.key === '?') { event.preventDefault(); setExtrasOpen((value) => !value) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // 多音轨（B6）：Chromium 不暴露 audioTracks，切轨只能走兼容转码——这里检测并在转码时指定保留哪条
  const [audioTracks, setAudioTracks] = useState<CompatAudioTrack[]>([])
  const [audioIndex, setAudioIndex] = useState(0)
  const [probingAudio, setProbingAudio] = useState(false)
  const trackLabel = (track: CompatAudioTrack, index: number) => {
    const parts = [`${index + 1}. ${track.codec.toUpperCase()}`]
    if (track.language) parts.push(track.language)
    if (track.title) parts.push(track.title)
    if (track.channels) parts.push(`${track.channels}ch`)
    return parts.join(' · ')
  }
  const probeAudioTracks = async () => {
    setProbingAudio(true)
    try {
      const result = await ipc.compatPlan(infoHash, file.path, 0).catch(() => null)
      if (!result?.success || !result.data) { pushToast(result?.error || t('player.audioReadFailed')); return }
      setAudioTracks(result.data.audioTracks || [])
      setAudioIndex(0)
      if ((result.data.audioTracks || []).length <= 1) pushToast(t('player.singleAudio'))
    } finally { setProbingAudio(false) }
  }

  return <div className="player-page"><header className="player-header"><button className="back-link" onClick={onBack}>{t('player.back')}</button><div className="player-heading"><span className={`file-icon ${file.type}`}>{file.type === 'audio' ? '♫' : '▶'}</span><div><h2>{file.name}</h2><p>{file.type === 'audio' ? t('player.audioPlayback') : t('player.videoPlayback')}</p></div></div>{playlist.length > 1 && <div className="playlist-controls"><button className="playlist-button" disabled={currentIndex <= 0} onClick={() => playIndex(currentIndex - 1)} title={t('player.prevEpisode')}>⏮</button>{episodeTag && <span className="playlist-episode">{episodeLabel(episodeTag)}</span>}<span className="playlist-index">{currentIndex + 1} / {playlist.length}</span><button className="playlist-button" disabled={currentIndex < 0 || currentIndex >= playlist.length - 1} onClick={() => playIndex(currentIndex + 1)} title={nextEntry ? `下一集：${nextEntry.torrentName}${episodeLabel(parseEpisode(nextEntry.file.name)) ? ` · ${episodeLabel(parseEpisode(nextEntry.file.name))}` : ''}` : '下一集'}>⏭</button><button className={`playlist-button autoplay-toggle ${autoPlay ? 'is-on' : ''}`} onClick={toggleAutoPlay} title={t('player.autoplayTitle')}>{t('player.autoplay')}{autoPlay ? t('player.on') : t('player.off')}</button></div>}<button className={`playlist-button subtitle-trigger ${subtitleOpen || activeTrack >= 0 ? 'is-on' : ''}`} onClick={() => setSubtitleOpen((value) => !value)} title={t('player.subtitleTitle')}>{t('player.subtitle')}{activeTrack >= 0 ? ' ●' : ''}</button><button className={`playlist-button subtitle-trigger ${extrasOpen ? 'is-on' : ''}`} onClick={() => setExtrasOpen((value) => !value)} title={t('player.extrasTitle')}>{t('player.extras')}</button><button className="playlist-button compat-trigger" onClick={() => void startCompatPlayback()} disabled={compat.phase === 'preparing' || compat.phase === 'running'} title={t('player.compatTitle')}>⇄ 兼容播放</button>{extrasOpen && <div className="subtitle-panel extras-panel">
  <div className="subtitle-panel-head"><span>{t('player.settings')}</span><button className="subtitle-close" onClick={() => setExtrasOpen(false)} aria-label={t('player.closeSettings')}>×</button></div>
  <div className="extras-section">
    <div className="extras-title">{t('player.marks')}<span className="extras-note">{t('player.marksNote')}</span></div>
    <div className="extras-marks">
      <span>{t('player.introEnd')} <b>{showMarks.introEnd !== undefined ? formatMark(showMarks.introEnd) : t('player.unmarked')}</b></span>
      <span>{t('player.outroStart')} <b>{showMarks.outroStart !== undefined ? formatMark(showMarks.outroStart) : '未标记'}</b></span>
    </div>
    <div className="subtitle-actions"><button className="small-button" onClick={() => markCurrent('intro')}>{t('player.markIntro')}</button><button className="small-button" onClick={() => markCurrent('outro')}>{t('player.markOutro')}</button></div>
    <label className="settings-check extras-check"><input type="checkbox" checked={skipEnabled} onChange={toggleSkip} />{t('player.skipEnabled')}</label>
    {(showMarks.introEnd !== undefined || showMarks.outroStart !== undefined) && <div className="subtitle-actions"><button className="small-button" onClick={clearMarks}>{t('player.clearMarks')}</button></div>}
  </div>
  <div className="extras-section">
    <div className="extras-title">{t('player.pictureSection')}</div>
    <div className="subtitle-actions"><button className="small-button" onClick={() => void togglePictureInPicture()} disabled={!document.pictureInPictureEnabled}>{document.pictureInPictureElement ? t('player.pipExit') : t('player.pip')}</button><span className="subtitle-hint">{document.pictureInPictureEnabled ? t('player.pipHint') : t('player.pipUnsupported')}</span></div>
    <div className="subtitle-actions"><button className="small-button" onClick={() => void probeAudioTracks()} disabled={probingAudio}>{probingAudio ? t('player.probing') : t('player.probeAudio')}</button><span className="subtitle-hint">{t('player.audioHint')}</span></div>
    {audioTracks.length > 1 && <div className="audio-tracks">
      {audioTracks.map((track, index) => (
        <button key={`${track.index}-${index}`} className={`subtitle-track ${audioIndex === index ? 'is-active' : ''}`} onClick={() => setAudioIndex(index)} title={trackLabel(track, index)}>
          <span className="subtitle-track-name">{trackLabel(track, index)}</span>
        </button>
      ))}
    </div>}
  </div>
  <div className="extras-section">
    <div className="extras-title">{t('player.shortcuts')}</div>
    <div className="shortcut-list">
      <span><kbd>Space</kbd>{t('player.shortcutPlay')}</span>
      <span><kbd>←</kbd><kbd>→</kbd>{t('player.shortcutSeek')}</span>
      <span><kbd>↑</kbd><kbd>↓</kbd>{t('player.shortcutVolume')}</span>
      <span><kbd>M</kbd>{t('player.shortcutMute')}<kbd>F</kbd>{t('player.shortcutFullscreen')}</span>
      <span><kbd>P</kbd>{t('player.shortcutPip')}<kbd>?</kbd>{t('player.shortcutPanel')}</span>
      <span><kbd>I</kbd>标记片头结束<kbd>O</kbd>标记片尾开始</span>
    </div>
  </div>
</div>}{subtitleOpen && <div className="subtitle-panel">
  <div className="subtitle-panel-head"><span>字幕</span><button className="subtitle-close" onClick={() => setSubtitleOpen(false)} aria-label="关闭字幕面板">×</button></div>
  <div className="subtitle-tracks">
    <button className={`subtitle-track ${activeTrack < 0 ? 'is-active' : ''}`} onClick={() => showTrack(-1)}>{t('player.subtitleOff')}</button>
    {subtitleItems.map((item, index) => (
      <button key={item.path} className={`subtitle-track ${activeTrack === index ? 'is-active' : ''}`} onClick={() => showTrack(index)} title={item.name}>
        <span className="subtitle-track-name">{item.name}</span>
        {item.language && <span className="subtitle-track-lang">{item.language}</span>}
      </button>
    ))}
    {!subtitleItems.length && <span className="subtitle-empty">{t('player.subtitleEmpty')}</span>}
  </div>
  <div className="subtitle-actions"><button className="small-button" onClick={() => subtitleInputRef.current?.click()}>{t('player.loadSubtitle')}</button><span className="subtitle-hint">{t('player.subtitleFormats')}</span></div>
  <div className="subtitle-setting"><label>{t('player.delay')}</label><div className="subtitle-delay"><button onClick={() => changeDelay(-0.5)}>−0.5s</button><span>{cueDelay > 0 ? '+' : ''}{cueDelay.toFixed(1)}s</span><button onClick={() => changeDelay(0.5)}>+0.5s</button><button onClick={() => changeDelay(-cueDelay)}>{t('player.reset')}</button></div></div>
  <div className="subtitle-setting"><label>{t('player.fontSize')}</label><input type="range" min={0.6} max={2} step={0.1} value={cueStyle.scale} onChange={(event) => updateCueStyle({ scale: Number(event.target.value) })} /><span>{Math.round(cueStyle.scale * 100)}%</span></div>
  <div className="subtitle-setting"><label>{t('player.position')}</label><input type="range" min={0} max={30} step={1} value={cueStyle.bottom} onChange={(event) => updateCueStyle({ bottom: Number(event.target.value) })} /><span>{cueStyle.bottom}%</span></div>
  <div className="subtitle-setting"><label>{t('player.background')}</label><input type="range" min={0} max={90} step={5} value={cueStyle.bg} onChange={(event) => updateCueStyle({ bg: Number(event.target.value) })} /><span>{cueStyle.bg}%</span></div>
</div>}</header><input ref={subtitleInputRef} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(event) => { loadLocalSubtitle(event.target.files); event.target.value = '' }} /><div className="player-stage" style={{ '--cue-scale': cueStyle.scale, '--cue-bottom': `${cueStyle.bottom}%`, '--cue-bg': `rgba(0,0,0,${cueStyle.bg / 100})` } as React.CSSProperties}><div ref={containerRef} className="player-container" />{loading && compat.phase !== 'running' && compat.phase !== 'preparing' && <div className="player-overlay"><div className="loading-spinner" /><span>{statusText}</span></div>}{(compat.phase === 'preparing' || compat.phase === 'running') && <div className="player-overlay"><div className="loading-spinner" /><span>{compat.phase === 'preparing' ? t('player.compatPreparing') : t('player.compatRunning', { percent: compat.percent })}</span><small className="compat-reason">{compat.message}</small><button className="secondary-action" onClick={cancelCompatPlayback}>{t('player.cancel')}</button></div>}{error && compat.phase !== 'running' && compat.phase !== 'preparing' && <div className="player-overlay player-error"><span>{error}</span><div className="player-error-actions"><button className="secondary-action" onClick={() => void startCompatPlayback()}>{t('player.compatButton')}</button><button className="secondary-action" onClick={onBack}>{t('player.backToLibrary')}</button></div></div>}{compat.phase === 'error' && <div className="player-overlay player-error"><span>{compat.message}</span><div className="player-error-actions"><button className="secondary-action" onClick={() => setCompat((prev) => ({ ...prev, phase: 'idle' }))}>{t('player.close')}</button></div></div>}{!loading && !error && (resumeNotice || toast) && <div className="resume-toast">{toast || resumeNotice}</div>}{recording && <div className="record-badge"><span />REC {formatTime(recordSeconds)}</div>}</div></div>
}
export default Player
