// 边下边播：BT 任务的分片优先级参数（aria2 的 --bt-prioritize-piece）。
// 纯函数，便于单测：把「播放位置」换算成 head/tail 优先区间的字节数。
//
// 为什么需要：aria2 默认按「最稀有分片优先」下载，播放器读到哪就等哪，
// 大文件（尤其 4K remux）起播和拖动都会长时间转圈。head 覆盖「已播放位置 + 预读窗口」，
// tail 固定覆盖文件末尾（MP4 的 moov atom 可能在尾部，缺了这段根本无法起播）。
export const PRIORITIZE_HEAD_MIN = 2 * 1024 * 1024
export const PRIORITIZE_HEAD_MAX = 64 * 1024 * 1024
export const PRIORITIZE_TAIL = 4 * 1024 * 1024
export const DEFAULT_READ_WINDOW = 8 * 1024 * 1024

// aria2 选项里的容量写法（1024 进制）：512K / 4M
export function ariaSize(bytes: number): string {
  const value = Number.isFinite(bytes) ? Math.max(0, Math.floor(bytes)) : 0
  if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)}M`
  if (value >= 1024) return `${Math.round(value / 1024)}K`
  return String(value)
}

// 播放位置（字节偏移）→ aria2 的 bt-prioritize-piece 取值
export function prioritizePieceOption(offsetBytes = 0, windowBytes = DEFAULT_READ_WINDOW): string {
  const offset = Number.isFinite(offsetBytes) && offsetBytes > 0 ? offsetBytes : 0
  const window = Number.isFinite(windowBytes) && windowBytes > 0 ? windowBytes : DEFAULT_READ_WINDOW
  const head = Math.min(PRIORITIZE_HEAD_MAX, Math.max(PRIORITIZE_HEAD_MIN, offset + window))
  return `head=${ariaSize(head)},tail=${ariaSize(PRIORITIZE_TAIL)}`
}

// 播放进度 → 已播放位置的字节偏移（duration 未知时按 0 处理，退化为「优先开头」）
export function byteOffsetFor(positionSeconds: number, durationSeconds: number, fileSize: number): number {
  if (!Number.isFinite(positionSeconds) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0
  if (!Number.isFinite(fileSize) || fileSize <= 0) return 0
  const ratio = Math.min(1, Math.max(0, positionSeconds / durationSeconds))
  return Math.floor(ratio * fileSize)
}
