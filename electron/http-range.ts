// HTTP Range 解析（/stream 与 /compat 共用）：纯函数，便于单测覆盖 206/416/空文件等分支。
export type ByteRange =
  | { kind: 'full'; start: number; end: number }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'empty' }
  | { kind: 'invalid' }

// 只处理单一范围（浏览器 <video> 也不会发多范围请求）：
//   bytes=A-B / bytes=A- / bytes=-N（后缀范围）
export function parseByteRange(header: string | undefined, size: number): ByteRange {
  if (!Number.isFinite(size) || size <= 0) return { kind: 'empty' }
  if (!header) return { kind: 'full', start: 0, end: size - 1 }
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return { kind: 'invalid' }
  let start: number
  let end = size - 1
  if (match[1] === '') start = Math.max(0, size - Number(match[2]))
  else {
    start = Number(match[1])
    if (match[2] !== '') end = Math.min(Number(match[2]), size - 1)
  }
  if (!Number.isFinite(start) || start > end || start >= size) return { kind: 'invalid' }
  return { kind: 'partial', start, end }
}
