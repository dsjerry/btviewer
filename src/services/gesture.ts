// 手势判定（纯函数，不碰 DOM 与 MediaPipe，便于穷举单测）。输入为 HandLandmarker 的 21 个归一化关键点。
// 三个基础手势：张开手掌 = 播放/暂停；食指水平挥动 = 快进/快退；握拳 = 静音/取消静音。

export interface Point { x: number; y: number }
export type GestureAction = 'toggle-play' | 'seek-forward' | 'seek-backward' | 'toggle-mute'
export type HandPose = 'palm' | 'fist' | 'point' | null

// 关键点编号（MediaPipe Hand Landmark）：0 腕部；食指 5-8、中指 9-12、无名指 13-16、小指 17-20（PIP 与指尖成对）
const WRIST = 0
const FINGER_JOINTS: Array<[pip: number, tip: number]> = [[6, 8], [10, 12], [14, 16], [18, 20]]
// 指尖到腕部的距离超过 PIP 到腕部距离的倍数才视为伸直，过滤半握状态的抖动
const EXTEND_RATIO = 1.2
const CONFIRM_FRAMES = 3
const SWIPE_WINDOW_MS = 500
// 归一化画面宽度：挥动距离超过 18% 画面宽才算一次挥动
const SWIPE_MIN_DISTANCE = 0.18
const COOLDOWN_MS: Record<GestureAction, number> = { 'toggle-play': 1000, 'toggle-mute': 1200, 'seek-forward': 800, 'seek-backward': 800 }

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

// 食指、中指、无名指、小指是否伸直（拇指姿态受遮挡影响大，不参与判定）
export function fingerStates(landmarks: Point[]): boolean[] {
  const wrist = landmarks[WRIST]
  return FINGER_JOINTS.map(([pip, tip]) => distance(wrist, landmarks[tip]) > distance(wrist, landmarks[pip]) * EXTEND_RATIO)
}

export function classifyPose(landmarks: Point[]): HandPose {
  const [index, middle, ring, pinky] = fingerStates(landmarks)
  if (index && middle && ring && pinky) return 'palm'
  if (!index && !middle && !ring && !pinky) return 'fist'
  if (index && !middle && !ring && !pinky) return 'point'
  return null
}

// 有状态的识别器：同一姿势连续确认后触发一次（边沿触发），每个动作有冷却时间，避免一次动作连续触发
export class GestureTracker {
  private pose: HandPose = null
  private streak = 0
  private swipe: { x: number; t: number } | null = null
  private lastFired: Partial<Record<GestureAction, number>> = {}

  // landmarks 为 null 表示画面中没有手；返回本帧触发的动作（没有则为 null）
  push(landmarks: Point[] | null, now: number): GestureAction | null {
    if (!landmarks) { this.reset(); return null }
    const pose = classifyPose(landmarks)
    if (pose !== this.pose) { this.pose = pose; this.streak = 0; this.swipe = null }
    this.streak++
    if (pose === 'point') return this.trackSwipe(landmarks[8].x, now)
    if (this.streak !== CONFIRM_FRAMES) return null
    if (pose === 'palm') return this.fire('toggle-play', now)
    if (pose === 'fist') return this.fire('toggle-mute', now)
    return null
  }

  reset(): void {
    this.pose = null
    this.streak = 0
    this.swipe = null
  }

  private trackSwipe(x: number, now: number): GestureAction | null {
    if (!this.swipe || now - this.swipe.t > SWIPE_WINDOW_MS) { this.swipe = { x, t: now }; return null }
    const dx = x - this.swipe.x
    if (Math.abs(dx) < SWIPE_MIN_DISTANCE) return null
    this.swipe = null
    // 摄像头画面未镜像：用户手向自己右侧挥动时画面中 x 减小，因此 dx < 0 为快进
    return this.fire(dx < 0 ? 'seek-forward' : 'seek-backward', now)
  }

  private fire(action: GestureAction, now: number): GestureAction | null {
    const last = this.lastFired[action]
    if (last !== undefined && now - last < COOLDOWN_MS[action]) return null
    this.lastFired[action] = now
    return action
  }
}
