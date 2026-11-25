import { ipc } from './ipc'
import { sampleTimes, type DetectedFaceDraft } from './people'
import type { FaceAnalyzer } from './face-analyzer'

// 人物合集的后台分析循环（渲染层）：取下一个已下载完成的视频 → 按时长抽帧 → 人脸检测与识别 → 提交主进程入库。
// 播放页内暂停，避免与视频解码争抢 CPU；没有待分析视频时每分钟检查一次，新下载完成的视频会被发现。
export interface PeopleAnalysisStatus { state: 'idle' | 'running' | 'paused'; current: string | null }

let running = false
let paused = false
let status: PeopleAnalysisStatus = { state: 'idle', current: null }
const listeners = new Set<(next: PeopleAnalysisStatus) => void>()
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function publish(current: string | null) {
  const state = !running ? 'idle' : paused ? 'paused' : 'running'
  status = { state, current: running ? current : null }
  listeners.forEach((listener) => listener(status))
}

// 订阅分析状态（立即回调一次当前值），返回取消订阅函数
export function subscribePeopleAnalysis(listener: (next: PeopleAnalysisStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => { listeners.delete(listener) }
}

export function setPeopleAnalysisPaused(value: boolean) {
  paused = value
  publish(status.current)
}

export function startPeopleAnalysis() {
  if (running) return
  running = true
  publish(null)
  void loop()
}

export function stopPeopleAnalysis() {
  running = false
  publish(null)
}

async function loadAnalyzer(): Promise<FaceAnalyzer | null> {
  try {
    const { createFaceAnalyzer } = await import('./face-analyzer')
    return await createFaceAnalyzer()
  } catch {
    // 模型缺失或运行时不可用：停止循环，由设置页重新开启时再尝试
    return null
  }
}

async function analyzeVideo(analyzer: FaceAnalyzer, path: string, duration: number): Promise<DetectedFaceDraft[] | null> {
  const drafts: DetectedFaceDraft[] = []
  for (const t of sampleTimes(duration)) {
    while (running && paused) await sleep(1000)
    if (!running) return null
    try {
      const frame = await ipc.peopleFrame(path, t).catch(() => null)
      if (!frame?.success || !frame.data) continue
      const bitmap = await createImageBitmap(new Blob([new Uint8Array(frame.data)], { type: 'image/jpeg' }))
      try { drafts.push(...await analyzer.analyze(bitmap, t)) } finally { bitmap.close() }
    } catch { /* 单帧解码或推理失败只跳过该帧，不影响整片 */ }
    await sleep(100)
  }
  return drafts
}

async function loop() {
  const analyzer = await loadAnalyzer()
  if (!analyzer) { running = false; publish(null); return }
  try {
    while (running) {
      while (running && paused) await sleep(1000)
      const job = await ipc.peopleNextJob().catch(() => null)
      if (!job?.success || !job.data) { publish(null); await sleep(60_000); continue }
      const { key, path, duration } = job.data
      publish(path)
      const drafts = await analyzeVideo(analyzer, path, duration).catch(() => null)
      if (!drafts) { publish(null); await sleep(5000); continue }
      if (running) await ipc.peopleSubmit(key, duration, drafts)
      publish(null)
    }
  } finally {
    analyzer.close()
    running = false
    publish(null)
  }
}
