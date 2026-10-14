import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

// yt-dlp 外挂引擎：视频站点的探测与下载。
// 进度/元信息解析为纯函数（可单测），进程生命周期由 torrent-engine 调度并映射为统一的任务状态。
// Windows 管道下 yt-dlp（PyInstaller）按系统 locale（GBK）输出含中文的路径，
// 统一注入 PYTHONUTF8/PYTHONIOENCODING，解码端再做 GBK 兜底（见 decodeLine）。

const PY_ENV = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } as const

export interface VideoProbe { title: string; ext?: string; size?: number; duration?: number; extractor?: string; client?: string; noCookies?: boolean }

// yt-dlp 2025+ 已弃用内置 JS 解释器：解 YouTube 的 n 签名挑战需要外部运行时，
// 否则带 cookies 的会话会 "n challenge solving failed"（表现为 Video unavailable / 格式受限）
export interface JsRuntimeInfo { name: string; path: string; version?: string }

export interface YtdlpRunOptions { proxy?: string; cookiesBrowser?: string; client?: string; jsRuntime?: string }

const SIZE_UNITS: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }

// [download]  45.3% of 123.45MiB at 2.34MiB/s ETA 00:12；~ 前缀表示总大小为估算值（HLS/DASH 分段流）
const PROGRESS_RE = /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)\s*(B|KiB|MiB|GiB|TiB)(?:\s+at\s+([\d.]+)\s*(B|KiB|MiB|GiB|TiB)\/s)?(?:\s+ETA\s+([\d:]+|Unknown))?(?:\s+in\s+[\d:]+)?/

export interface YtdlpProgress { percent: number; totalSize?: number; speed?: number; eta?: number }

export function parseProgressLine(line: string): YtdlpProgress | null {
  const match = PROGRESS_RE.exec(line)
  if (!match) return null
  const unit = SIZE_UNITS[match[3]]
  if (!unit) return null
  const percent = parseFloat(match[1])
  if (!Number.isFinite(percent)) return null
  const speedUnit = match[5] ? SIZE_UNITS[match[5]] : undefined
  return {
    percent,
    totalSize: parseFloat(match[2]) * unit,
    speed: speedUnit && match[4] ? parseFloat(match[4]) * speedUnit : undefined,
    eta: match[6] && match[6] !== 'Unknown' ? etaSeconds(match[6]) : undefined
  }
}

// ETA 支持 mm:ss 与 hh:mm:ss 两种形态
function etaSeconds(value: string) {
  const parts = value.split(':').map(Number)
  if (!parts.length || parts.some((item) => !Number.isFinite(item))) return undefined
  return parts.reduce((sum, item) => sum * 60 + item, 0)
}

// --dump-single-json 的单视频元信息；playlist 或解析失败返回 null
export function parseVideoProbe(json: string): VideoProbe | null {
  try {
    const data = JSON.parse(json) as Record<string, unknown>
    if (!data || data._type === 'playlist') return null
    const title = typeof data.title === 'string' ? data.title : ''
    if (!title) return null
    const size = typeof data.filesize === 'number' && data.filesize > 0 ? data.filesize : typeof data.filesize_approx === 'number' && data.filesize_approx > 0 ? data.filesize_approx : undefined
    return {
      title,
      ext: typeof data.ext === 'string' ? data.ext : undefined,
      size,
      duration: typeof data.duration === 'number' ? data.duration : undefined,
      extractor: typeof data.extractor_key === 'string' ? data.extractor_key : undefined
    }
  } catch { return null }
}

const detectCache = new Map<string, Promise<string | null>>()

// 探测外部可执行文件（成功执行 --version 即视为可用）；按名称+路径缓存，设置变更后可清空
// 查找顺序：自定义路径 > extraDir（应用内自动安装目录）> 系统 PATH
export function detectBinary(customPath: string | undefined, name: 'yt-dlp' | 'ffmpeg', extraDir?: string): Promise<string | null> {
  const key = `${name}:${customPath || ''}:${extraDir || ''}`
  let cached = detectCache.get(key)
  if (!cached) { cached = doDetectBinary(customPath, name, extraDir); detectCache.set(key, cached) }
  return cached
}

export function clearDetectCache() { detectCache.clear(); jsRuntimeCache.clear() }

// deno 是 yt-dlp 默认启用的运行时；node/bun 需显式声明。查找顺序：应用内安装目录 > 系统 PATH。
// 版本门槛来自 yt-dlp/ejs：deno>=2.3、node>=22（v20/v21 已移除支持）、bun 已废弃且限定区间。
// 注意：Electron 内嵌的 Node 不可用（不是独立可执行文件，且 Electron 33 的 Node 20 低于门槛）。
interface JsRuntimeSpec { name: string; min: [number, number, number]; max?: [number, number, number] }
const JS_RUNTIME_SPECS: JsRuntimeSpec[] = [
  { name: 'deno', min: [2, 3, 0] },
  { name: 'node', min: [22, 0, 0] },
  { name: 'bun', min: [1, 2, 11], max: [1, 3, 14] }
]
const jsRuntimeCache = new Map<string, Promise<JsRuntimeInfo | null>>()

export function detectJsRuntime(extraDir?: string): Promise<JsRuntimeInfo | null> {
  const key = extraDir || ''
  let cached = jsRuntimeCache.get(key)
  if (!cached) { cached = doDetectJsRuntime(extraDir); jsRuntimeCache.set(key, cached) }
  return cached
}

// 从 --version 输出中提取首个语义化版本号（deno 输出多行，node 带 v 前缀，bun 为裸版本号）
export function parseRuntimeVersion(output: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(output)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isRuntimeVersionSupported(name: string, version: [number, number, number] | null): boolean {
  const spec = JS_RUNTIME_SPECS.find((item) => item.name === name)
  if (!spec || !version) return false
  const compare = (a: [number, number, number], b: [number, number, number]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
  if (compare(version, spec.min) < 0) return false
  if (spec.max && compare(version, spec.max) > 0) return false
  return true
}

async function doDetectJsRuntime(extraDir?: string): Promise<JsRuntimeInfo | null> {
  for (const spec of JS_RUNTIME_SPECS) {
    const bare = process.platform === 'win32' ? [`${spec.name}.exe`, spec.name] : [spec.name]
    const candidates = [...(extraDir ? bare.map((item) => join(extraDir, item)) : []), ...bare]
    for (const candidate of candidates) {
      if ((candidate.includes('\\') || candidate.includes('/')) && !existsSync(candidate)) continue
      const output = await readVersion(candidate)
      if (output === null) continue
      const version = parseRuntimeVersion(output)
      if (isRuntimeVersionSupported(spec.name, version)) return { name: spec.name, path: candidate, version: version!.join('.') }
    }
  }
  return null
}

// 执行 --version 并返回输出（stdout+stderr）；无法执行或超时返回 null
function readVersion(candidate: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: string | null) => { if (!settled) { settled = true; resolve(value) } }
    try {
      const child = spawn(candidate, ['--version'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
      const timer = setTimeout(() => { child.kill(); done(null) }, 10000)
      child.once('error', () => { clearTimeout(timer); done(null) })
      child.once('exit', (code) => { clearTimeout(timer); done(code === 0 ? output : null) })
    } catch { done(null) }
  })
}

// --js-runtimes 取值：带路径分隔符时写成 name:path（deno 之外的运行时必须带 path；deno 带 path 亦合法）
export function jsRuntimeArg(runtime: JsRuntimeInfo | null | undefined): string | undefined {
  if (!runtime) return undefined
  return runtime.path.includes('\\') || runtime.path.includes('/') ? `${runtime.name}:${runtime.path}` : runtime.name
}

// 下载格式选择：优选「同容器」组合，合并后可直接被内置播放器（Chromium）播放：
//   mp4 视频(avc1/av01) + m4a 音频 → mp4；webm 视频(vp9/av01) + webm 音频 → webm
// 关键：不能强制 avc1——h264 在 YouTube 最高只有 1080p，强制它会丢掉 4K（4K 仅 vp9/av01 提供）。
// 无 ffmpeg 时只能下预合并单文件（YouTube 默认 360p）。
export function videoFormat(hasFfmpeg: boolean): string {
  return hasFfmpeg
    ? 'bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=webm]+ba[ext=webm]/bv*+ba/b'
    : 'b[ext=mp4]/b'
}

export function binaryVersionArgs(name: 'yt-dlp' | 'ffmpeg'): string[] {
  return name === 'ffmpeg' ? ['-version'] : ['--version']
}

export function isBinaryUsable(candidate: string, name: 'yt-dlp' | 'ffmpeg'): Promise<boolean> {
  return versionCheck(candidate, binaryVersionArgs(name))
}

async function doDetectBinary(customPath: string | undefined, name: 'yt-dlp' | 'ffmpeg', extraDir?: string): Promise<string | null> {
  // 自定义路径必须真实存在；裸名交给系统 PATH 解析（Windows 下显式补 .exe 优先）
  const bare = process.platform === 'win32' ? [`${name}.exe`, name] : [name]
  const candidates = [
    ...(customPath ? [customPath] : []),
    ...(extraDir ? bare.map((item) => join(extraDir, item)) : []),
    ...bare
  ]
  for (const candidate of candidates) {
    if (candidate.includes('\\') || candidate.includes('/')) { if (!existsSync(candidate)) continue }
    if (await isBinaryUsable(candidate, name)) return candidate
  }
  return null
}

function versionCheck(candidate: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    const done = (value: boolean) => { if (!settled) { settled = true; resolve(value) } }
    try {
      const child = spawn(candidate, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      const timer = setTimeout(() => { child.kill(); done(false) }, 10000)
      child.once('error', () => { clearTimeout(timer); done(false) })
      child.once('exit', (code) => { clearTimeout(timer); done(code === 0) })
    } catch { done(false) }
  })
}

export interface ProbeResult { probe: VideoProbe | null; botCheck: boolean; restricted: boolean; cookieFail: boolean; errorLine: string }

// 探测 URL 是否为可解析的视频站点条目；botCheck 标记 YouTube 风控，restricted 标记格式受限，
// cookieFail 标记浏览器 Cookies 读取失败，errorLine 透传站点错误（视频不可用等）供调用方分类
export async function probeVideoSite(binary: string, url: string, opts: YtdlpRunOptions & { timeoutMs?: number } = {}): Promise<ProbeResult> {
  const { proxy, cookiesBrowser, client, jsRuntime, timeoutMs = 45000 } = opts
  return new Promise((resolve) => {
    let settled = false
    const done = (patch: Partial<ProbeResult>) => { if (!settled) { settled = true; resolve({ probe: null, botCheck: false, restricted: false, cookieFail: false, errorLine: '', ...patch }) } }
    try {
      const args = ['--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download']
      if (jsRuntime) args.push('--js-runtimes', jsRuntime)
      if (client) args.push('--extractor-args', `youtube:player_client=${client}`)
      if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser)
      if (proxy) args.push('--proxy', proxy)
      args.push(url)
      const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...PY_ENV } })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk })
      const timer = setTimeout(() => { child.kill(); done({}) }, timeoutMs)
      child.once('error', () => { clearTimeout(timer); done({}) })
      child.once('exit', (code) => {
        clearTimeout(timer)
        if (code !== 0) {
          done({
            botCheck: /sign in to confirm/i.test(stderr),
            cookieFail: /cookie|dpapi/i.test(stderr),
            errorLine: stderr.trim().split('\n').filter((line) => line.startsWith('ERROR')).pop() || ''
          })
          return
        }
        const probe = parseVideoProbe(stdout)
        if (probe && client) probe.client = client
        // 有标题但 formats 全部不可播（storyboard 占位等）→ 受限，调用方换客户端重试
        let restricted = false
        try {
          const data = JSON.parse(stdout) as Record<string, unknown>
          const formats = Array.isArray(data.formats) ? data.formats as Array<Record<string, unknown>> : []
          if (data.title && formats.length) restricted = !formats.some((item) => item && (item.vcodec !== 'none' || item.acodec !== 'none'))
        } catch { /* 非 JSON 输出 */ }
        done({ probe, restricted })
      })
    } catch { done({}) }
  })
}

export interface YtdlpDownloadHandlers {
  onLine: (line: string) => void
  onExit: (code: number | null, stderrTail: string) => void
  onError: (error: Error) => void
}

export interface YtdlpDownloadOptions extends YtdlpRunOptions { ffmpegLocation?: string }

// 启动 yt-dlp 下载：--newline 让每次进度刷新独占一行；--print after_move:filepath 输出最终文件路径；
// ffmpegLocation 用于应用内安装的 ffmpeg（不在 PATH 时显式告知合并工具位置）。
// 不指定 --merge-output-format：让 yt-dlp 按「同容器」自动选（mp4+m4a→mp4，webm+webm→webm），两者都能被 Chromium 播放
export function spawnYtdlpDownload(binary: string, url: string, dir: string, format: string, handlers: YtdlpDownloadHandlers, opts: YtdlpDownloadOptions = {}): ChildProcess {
  const { proxy, ffmpegLocation, cookiesBrowser, client, jsRuntime } = opts
  const args = ['--newline', '--progress', '--no-warnings', '--no-playlist', '--continue', '--format', format, '--print', 'after_move:filepath']
  if (jsRuntime) args.push('--js-runtimes', jsRuntime)
  if (client) args.push('--extractor-args', `youtube:player_client=${client}`)
  if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser)
  if (proxy) args.push('--proxy', proxy)
  if (ffmpegLocation) args.push('--ffmpeg-location', ffmpegLocation)
  args.push('-P', dir, '-o', '%(title)s.%(ext)s', url)
  const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...PY_ENV } })
  lineFeed(child.stdout, handlers.onLine)
  let stderrTail = ''
  child.stderr.on('data', (chunk: Buffer) => { stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2000) })
  child.on('error', handlers.onError)
  child.on('exit', (code) => handlers.onExit(code, stderrTail))
  return child
}

// 逐行解码：先按 UTF-8，出现替换符（U+FFFD）时回退 GBK——yt-dlp 在 Windows 管道下按系统 locale 输出路径
export function decodeLine(raw: Buffer): string {
  const utf8 = raw.toString('utf8')
  if (!utf8.includes('\ufffd')) return utf8
  try { return new TextDecoder('gbk').decode(raw) } catch { return utf8 }
}

// 按行拆分 stdout：data chunk 可能切断行尾（多字节字符同样可能被切断），按字节缓冲后逐行解码
function lineFeed(stream: NodeJS.ReadableStream, onLine: (line: string) => void) {
  let buffer = Buffer.alloc(0)
  stream.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    let index: number
    while ((index = buffer.indexOf(0x0a)) >= 0) {
      const raw = buffer.subarray(0, index)
      buffer = buffer.subarray(index + 1)
      const line = decodeLine(raw).replace(/\r$/, '').trim()
      if (line) onLine(line)
    }
  })
}
