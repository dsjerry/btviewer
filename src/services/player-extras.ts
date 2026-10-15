// 播放器增强（B6）：片头/片尾标记与跳过决策。标记按「剧集键」记忆（同剧各集共用），
// 决策是纯函数，便于单测覆盖各种越界与非法输入。
import type { SkipMarks } from '../types'

export interface SkipDecision {
  action: 'intro' | 'outro'
  target: number
  label: string
}

// 片头标记至少 3 秒、片尾与片头之间至少留 30 秒，越界值一律收敛或丢弃
export function sanitizeMarks(marks: SkipMarks, duration = 0): SkipMarks {
  const next: SkipMarks = {}
  const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  if (valid(marks.introEnd) && marks.introEnd > 3) {
    next.introEnd = duration > 20 ? Math.min(marks.introEnd, duration - 10) : marks.introEnd
  }
  if (valid(marks.outroStart) && marks.outroStart > 0) {
    next.outroStart = duration > 10 ? Math.min(marks.outroStart, duration - 1) : marks.outroStart
  }
  if (next.introEnd !== undefined && next.outroStart !== undefined && next.outroStart - next.introEnd < 30) delete next.introEnd
  return next
}

export function skipDecision(position: number, duration: number, marks: SkipMarks, enabled: boolean): SkipDecision | null {
  if (!enabled || !Number.isFinite(position) || position < 0) return null
  const { introEnd, outroStart } = marks
  // 片头：只在还没播过片头时跳（留 0.5 秒容差，避免刚好等于标记点时反复触发）
  if (introEnd !== undefined && position >= 1 && position < introEnd - 0.5) {
    return { action: 'intro', target: introEnd, label: `已跳过片头（${formatMark(introEnd)}）` }
  }
  // 片尾：到点即跳过，交给连播逻辑切下一集
  if (outroStart !== undefined && outroStart > 0 && position >= outroStart && (!duration || position < duration - 0.2)) {
    return { action: 'outro', target: duration > 0 ? duration : outroStart, label: '已跳过片尾' }
  }
  return null
}

export function formatMark(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const mm = Math.floor(total / 60)
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// 标记库：{ [剧集键]: SkipMarks }，损坏的 JSON 一律当作空库
export function parseMarksStore(raw: string | null): Record<string, SkipMarks> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const store: Record<string, SkipMarks> = {}
    for (const [key, value] of Object.entries(parsed || {})) {
      if (!value || typeof value !== 'object') continue
      const marks = value as SkipMarks
      const clean = sanitizeMarks(marks)
      if (Object.keys(clean).length) store[key] = clean
    }
    return store
  } catch { return {} }
}

export function updateMarksStore(store: Record<string, SkipMarks>, seriesKey: string, marks: SkipMarks): Record<string, SkipMarks> {
  const next = { ...store }
  const clean = sanitizeMarks(marks)
  if (Object.keys(clean).length) next[seriesKey] = clean
  else delete next[seriesKey]
  return next
}
