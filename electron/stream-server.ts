// 本地媒体流服务（/stream、/subtitle、/compat）的纯逻辑：路由解析、鉴权、路径越界检查、Range 响应头。
// 这些函数只做「给请求/状态，返回该干什么」的判定，不碰 socket，也不持有引擎状态——
// 拆出来的目的：流服务是安全边界（token 鉴权 + 目录越界拦截），必须能被穷举单测。

import { isAbsolute, relative, resolve } from 'path'

export interface StreamRoute {
  // 路由种类；'unknown' 表示不认识的路径（404）
  kind: 'stream' | 'subtitle' | 'compat' | 'local' | 'unknown'
  // stream/subtitle：任务哈希；compat：转码会话 id；local：本地媒体注册 id
  id: string
  // stream/subtitle：aria2 的文件序号
  fileIndex?: string
}

// 只认这四种路径；其余一律 unknown（不落盘、不读状态）
export function parseStreamRoute(pathname: string): StreamRoute {
  const compat = /^\/compat\/([^/]+)$/.exec(pathname)
  if (compat) return { kind: 'compat', id: decodePart(compat[1]) }
  const stream = /^\/stream\/([^/]+)\/(\d+)$/.exec(pathname)
  if (stream) return { kind: 'stream', id: decodePart(stream[1]), fileIndex: stream[2] }
  const subtitle = /^\/subtitle\/([^/]+)\/(\d+)$/.exec(pathname)
  if (subtitle) return { kind: 'subtitle', id: decodePart(subtitle[1]), fileIndex: subtitle[2] }
  const local = /^\/local\/([0-9a-f]+)$/.exec(pathname)
  if (local) return { kind: 'local', id: local[1] }
  return { kind: 'unknown', id: '' }
}

// 非法百分号转义不应抛异常（会让整个 HTTP 服务崩溃）
function decodePart(value: string): string {
  try { return decodeURIComponent(value) } catch { return value }
}

// 常量时间比较：token 是本机其它进程能读到的唯一凭据，避免通过响应时间侧信道猜测
export function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i)
  return diff === 0
}

// 目标路径必须落在 root 之内（含 root 本身）。拒绝 `../` 穿越、绝对路径逃逸与大小写差异外的符号链接逃逸
// （符号链接由 realpath 之外的调用方决定，这里只做词法判定）。
export function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

// 字幕只接受播放器能挂载的格式（srt 由主进程转 vtt 后返回）
export const ATTACHABLE_SUBTITLES = ['.srt', '.vtt'] as const

export function subtitleExt(path: string): string {
  const index = path.lastIndexOf('.')
  return index < 0 ? '' : path.slice(index).toLowerCase()
}

export function isAttachableSubtitle(path: string): boolean {
  return (ATTACHABLE_SUBTITLES as readonly string[]).includes(subtitleExt(path))
}

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.vtt': 'text/vtt; charset=utf-8'
}

export function getMime(filename: string): string {
  return MIME_BY_EXT[subtitleExt(filename)] || 'application/octet-stream'
}

export interface RangeResponse {
  status: number
  headers: Record<string, string | number>
  // 需要读取的字节区间；空响应（HEAD/空文件/非法范围）时为 null
  body: { start: number; end: number } | null
}

// 把 parseByteRange 的结果翻成「状态码 + 响应头 + 要流的区间」，便于单测直接断言 200/206/416
export function buildRangeResponse(range: import('./http-range').ByteRange, size: number, filename: string, cors: Record<string, string>): RangeResponse {
  if (range.kind === 'empty') return { status: 200, headers: { ...cors, 'content-type': getMime(filename), 'content-length': 0 }, body: null }
  if (range.kind === 'invalid') return { status: 416, headers: { ...cors, 'content-range': `bytes */${size}` }, body: null }
  const headers: Record<string, string | number> = {
    ...cors,
    'content-type': getMime(filename),
    'content-length': range.end - range.start + 1,
    'accept-ranges': 'bytes'
  }
  if (range.kind === 'partial') headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`
  return { status: range.kind === 'partial' ? 206 : 200, headers, body: { start: range.start, end: range.end } }
}
