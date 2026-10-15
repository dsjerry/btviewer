// 设置项的纯校验逻辑：主进程不重复校验（渲染层拦截 + aria2 自身兜底），集中在这里便于单测
// aria2 的容量/速率写法：数字 + 可选 K/M（如 512K、10M）；0 表示不限速
const SIZE_LIMIT_RE = /^\d+(\.\d+)?[KMG]?$/i
// 监听端口：单个端口或 aria2 支持的区间写法（如 6881-6999）
const LISTEN_PORT_RE = /^\d{1,5}(-\d{1,5})?$/

export function validateSizeLimit(value: string): string {
  const limit = value.trim()
  if (!limit) return ''
  return SIZE_LIMIT_RE.test(limit) ? '' : '格式无效，示例：10M、512K、0（不限速）'
}

export function validateListenPort(value: string): string {
  const port = value.trim()
  if (!port) return ''
  if (!LISTEN_PORT_RE.test(port)) return '格式无效，示例：6881 或 6881-6999'
  const [start, end] = port.split('-').map(Number)
  if (start < 1 || start > 65535 || (end !== undefined && (end < 1 || end > 65535))) return '端口范围应在 1-65535 之间'
  if (end !== undefined && end < start) return '结束端口不能小于起始端口'
  return ''
}

export function validateSeedRatio(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 100) return '分享率应在 0-100 之间'
  return ''
}

export function validateSeedMinutes(value: number): string {
  if (!Number.isFinite(value) || value < 1 || value > 60 * 24 * 30) return '做种时长应在 1 分钟到 30 天之间'
  return ''
}

export function validateRetries(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 10) return '重试次数应在 0-10 之间'
  return ''
}
