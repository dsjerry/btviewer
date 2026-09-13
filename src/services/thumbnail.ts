import { ipc } from './ipc'

// 渲染层视频截帧：隐藏 <video> 加载流（支持 Range），seek 后 canvas 截图输出 dataURL
// 失败结果仅在本次会话内负缓存（文件后续下载完成可能就能截出来了），成功结果持久化到主进程
const WIDTH = 320
const TIMEOUT_MS = 15000

const memory = new Map<string, string | null>()
interface Job { key: string; infoHash: string; filePath: string; callbacks: Array<(value: string | null) => void> }
const queue: Job[] = []
let pumping = false

const keyOf = (infoHash: string, filePath: string) => `${infoHash}:${filePath}`

function capture(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    // 流服务带 CORS 头；显式声明避免跨源（dev server）时 canvas 被污染无法导出
    video.crossOrigin = 'anonymous'
    let settled = false
    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      video.removeAttribute('src')
      try { video.load() } catch { /* 已移除源时忽略 */ }
      resolve(result)
    }
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS)
    video.addEventListener('loadedmetadata', () => {
      if (settled) return
      const duration = video.duration
      const target = Number.isFinite(duration) && duration > 0 ? Math.min(duration * 0.2, 45) : 1
      try { video.currentTime = Math.max(0.5, target) } catch { finish(null) }
    })
    video.addEventListener('seeked', () => {
      if (settled) return
      try {
        const width = video.videoWidth
        const height = video.videoHeight
        if (!width || !height) { finish(null); return }
        const canvas = document.createElement('canvas')
        canvas.width = WIDTH
        canvas.height = Math.max(1, Math.round((height / width) * WIDTH))
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
        finish(canvas.toDataURL('image/jpeg', 0.7))
      } catch { finish(null) }
    })
    video.addEventListener('error', () => finish(null))
    video.src = url
  })
}

async function pump() {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const job = queue.shift()!
      let result: string | null = null
      try {
        result = await capture(await ipc.getStreamUrl(job.infoHash, job.filePath))
      } catch { /* 任务可能已被移除，按失败处理 */ }
      memory.set(job.key, result)
      if (result) void ipc.saveThumbnail(job.key, result).catch(() => undefined)
      for (const callback of job.callbacks) callback(result)
    }
  } finally { pumping = false }
}

// 串行队列：media 库页面可能同时出现几十个视频，避免并发截帧挤占带宽
async function getThumbnail(infoHash: string, filePath: string): Promise<string | null> {
  const key = keyOf(infoHash, filePath)
  if (memory.has(key)) return memory.get(key)!
  const persisted = await ipc.getThumbnails([key]).then((result) => (result.success && result.data ? result.data[0] : null)).catch(() => null)
  if (persisted) { memory.set(key, persisted); return persisted }
  return new Promise((resolve) => {
    const existing = queue.find((job) => job.key === key)
    if (existing) { existing.callbacks.push(resolve); return }
    queue.push({ key, infoHash, filePath, callbacks: [resolve] })
    void pump()
  })
}

export default getThumbnail
