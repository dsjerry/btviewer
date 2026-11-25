import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'
import { GestureTracker, type GestureAction } from './gesture'

// 手势控制运行时：摄像头 → HandLandmarker（VIDEO 模式，约 12fps）→ GestureTracker。
// 只在播放页动态加载并调用；stop() 释放摄像头与模型。WASM 与模型经 ai:// 协议读取（见 electron/ai-models.ts）。
const FRAME_INTERVAL_MS = 80
const MODEL_URL = 'ai://models/hand_landmarker.task'
const WASM_BASE = 'ai://wasm'

export interface GestureController { stop: () => void }

async function createLandmarker(vision: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>): Promise<HandLandmarker> {
  const options = { baseOptions: { modelAssetPath: MODEL_URL }, runningMode: 'VIDEO' as const, numHands: 1 }
  try {
    return await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } })
  } catch {
    // GPU delegate 在部分显卡驱动上不可用，回退到 CPU 推理
    return HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } })
  }
}

export async function startGestureControl(onAction: (action: GestureAction) => void): Promise<GestureController> {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  let stream: MediaStream | null = null
  let landmarker: HandLandmarker | null = null
  let frame = 0
  let stopped = false
  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    stream?.getTracks().forEach((track) => track.stop())
    video.srcObject = null
    landmarker?.close()
  }
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_BASE)
    landmarker = await createLandmarker(vision)
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360, facingMode: 'user' }, audio: false })
    video.srcObject = stream
    await video.play()
  } catch (error) {
    stop()
    throw error
  }
  const hand = landmarker
  const tracker = new GestureTracker()
  let last = 0
  const loop = (now: number) => {
    if (stopped) return
    frame = requestAnimationFrame(loop)
    if (now - last < FRAME_INTERVAL_MS || video.readyState < 2) return
    last = now
    const result = hand.detectForVideo(video, now)
    const action = tracker.push(result.landmarks[0] ?? null, now)
    if (action) onAction(action)
  }
  frame = requestAnimationFrame(loop)
  return { stop }
}
