// 剪贴板监听（C4）：复制到磁力/直链时提示一键添加。
// 这里只做「文本里有没有可用链接」与「什么时候该提示」的纯逻辑，读剪贴板由调用方注入。
export const CLIPBOARD_INTERVAL_MS = 1500
// 超长文本（复制的整篇文章等）直接忽略，避免把大段文字当链接处理
const MAX_INPUT_LENGTH = 8192
// 直接在内联文本里找链接：复制网页时常带前后缀与中英文标点，链接本身到空白/引号/成对符号/中文标点为止
const INPUT_RE = /(magnet:\?[^\s"'<>()[\]{}，。；、]+|(?:https?|ftp):\/\/[^\s"'<>()[\]{}，。；、]+)/i

// 从剪贴板文本里挑出第一个可用的下载输入；多余的文字、引号、尖括号与中英文标点都会被剔除
export function extractClipboardInput(text: string): string | null {
  const value = String(text || '').trim()
  if (!value || value.length > MAX_INPUT_LENGTH) return null
  const match = INPUT_RE.exec(value)
  if (!match) return null
  // 句末的英文标点不属于链接
  return match[1].replace(/[.,;:!?]+$/, '')
}

export interface ClipboardWatcherOptions {
  read: () => string
  onInput: (input: string) => void
  intervalMs?: number
}

// 每个链接只提示一次；同一段文本重复出现（用户没改剪贴板）不会反复提示
export function createClipboardWatcher({ read, onInput, intervalMs = CLIPBOARD_INTERVAL_MS }: ClipboardWatcherOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  let lastSeen = ''
  const handled = new Set<string>()

  const tick = () => {
    let text: string
    try { text = read() } catch { return }
    if (!text || text === lastSeen) return
    lastSeen = text
    const input = extractClipboardInput(text)
    if (!input || handled.has(input)) return
    handled.add(input)
    onInput(input)
  }

  return {
    // 启动时先记住当前剪贴板内容：开关打开前就复制好的链接不会立刻弹提示
    start() {
      if (timer) return
      try { lastSeen = read() } catch { lastSeen = '' }
      timer = setInterval(tick, intervalMs)
    },
    stop() {
      if (!timer) return
      clearInterval(timer)
      timer = null
    },
    // 用户点了忽略：之后不再提示这条链接
    ignore(input: string) { if (input) handled.add(input) },
    isRunning: () => !!timer
  }
}
