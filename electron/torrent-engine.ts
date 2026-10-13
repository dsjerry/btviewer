import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { app } from 'electron'
import { join, basename, dirname, isAbsolute, relative, resolve } from 'path'
import { createHash, randomBytes } from 'crypto'
import { XMLParser } from 'fast-xml-parser'
import { logger } from './logger'
import { writeJsonAtomic } from './storage'
import { clearDetectCache, detectBinary, detectJsRuntime, jsRuntimeArg, parseProgressLine, probeVideoSite, spawnYtdlpDownload, videoFormat, type VideoProbe } from './ytdlp-engine'
import type { ChildProcess } from 'child_process'
import type { TaskProtocol, TorrentFileInfo, TorrentStatus } from '../src/types'

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.rmvb']
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.sub']
// Chromium 原生只渲染 VTT：vtt 直接可用，srt 可本地无损转换；ass/ssa/sub 需要特效渲染库，暂不支持
const ATTACHABLE_SUBTITLES = ['.srt', '.vtt']
const RPC_VERSION = 'aria2'
// 内置公共 tracker 快照（来源 ngosang/trackerslist best，2026-09），裸磁力链只能靠 DHT 找节点，
// 部分网络会屏蔽 DHT 而 tracker 可用，注入后可大幅提高解析成功率；ARIA2_TRACKERS 可整体覆盖
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.qu.ax:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.therarbg.to:6969/announce',
  'udp://tracker.publictracker.xyz:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://tracker2.dler.org:80/announce',
  'http://tracker.qu.ax:6969/announce',
  'https://tracker.bt4g.com:443/announce',
  'https://tracker.zhuqiy.com:443/announce'
]

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } }
type AriaFile = { index: string; path: string; length: string; completedLength: string; selected: string }
type AriaStatus = { gid: string; status: string; totalLength: string; completedLength: string; downloadSpeed: string; uploadSpeed: string; uploadLength?: string; connections: string; dir: string; errorMessage?: string; bittorrent?: { infoHash?: string; info?: { name?: string } }; info?: string; followedBy?: string[]; belongsTo?: string; files?: AriaFile[] }

// 带 cookies 时使用的 YouTube 客户端：web_embedded 可给到 4K（vp9/av01），对部分视频不可用时
// yt-dlp 会自动回退到列表里的 web_safari（最高 1080p 的 HLS 单文件）。默认客户端在登录会话下只返回 360p
const DEFAULT_COOKIE_CLIENT = 'web_embedded,web_safari'

// URL 以这些扩展名结尾时按直链处理，不再交给 yt-dlp 探测（网页类 URL 才走视频站点解析）
const DIRECT_MEDIA_EXTENSIONS = [...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS, '.zip', '.rar', '.7z', '.gz', '.iso', '.exe', '.apk', '.dmg', '.pdf', '.epub', '.txt', '.xml', '.json']

export type InputKind = 'magnet' | 'torrent' | 'metalink' | 'http' | 'ftp' | 'web' | 'unknown'
// 输入分流：决定任务走 BT、直链还是视频站点解析（web = http(s) 但非明显直链，需 yt-dlp 探测）
export function classifyInput(input: string): InputKind {
  const value = input.trim()
  if (!value) return 'unknown'
  if (/^magnet:\?/i.test(value)) return 'magnet'
  const path = value.toLowerCase().split(/[?#]/)[0]
  if (path.endsWith('.torrent')) return 'torrent'
  if (path.endsWith('.metalink') || path.endsWith('.meta4')) return 'metalink'
  if (/^https?:\/\//i.test(value)) return DIRECT_MEDIA_EXTENSIONS.some((ext) => path.endsWith(ext)) ? 'http' : 'web'
  if (/^ftp:\/\//i.test(value)) return 'ftp'
  return 'unknown'
}

// 非 BT 任务的稳定 key：sha1(source)。aria2 重启后 gid 会变，sha1 保证恢复后任务身份不变
function stableKey(source: string) { return createHash('sha1').update(source.trim()).digest('hex') }

// 直链任务展示名：URL 路径最后一段（解码后），取不到时用整个 URL
function directName(url: string) {
  try { const last = new URL(url).pathname.split('/').filter(Boolean).pop(); return last ? decodeURIComponent(last) : url } catch { return url }
}

// 与 yt-dlp 的 Windows 文件名清理近似：替换非法字符与首尾点空格；最终路径以 after_move:filepath 为准
function sanitizeFilename(name: string, ext?: string) {
  const clean = name.replace(/[\\/:*?"<>|\p{Cc}]/gu, '_').replace(/[. ]+$/, '').trim() || 'video'
  return ext ? `${clean}.${ext}` : clean
}

// Metalink XML → 文件条目（名称 + 镜像 URL 列表）；name 是 <file> 的属性，<url> 带属性时取 #text
function parseMetalink(xml: string): Array<{ name: string; urls: string[] }> {
  let parsed: { metalink?: { file?: unknown }; file?: unknown }
  try { parsed = new XMLParser({ ignoreAttributes: false }).parse(xml) } catch { throw new Error('无效的 metalink 文件') }
  const container = (parsed.metalink || parsed) as { file?: unknown }
  const rawFiles = Array.isArray(container.file) ? container.file : container.file ? [container.file] : []
  return rawFiles.map((file: { '@_name'?: unknown; name?: unknown; url?: unknown }) => ({
    name: typeof file['@_name'] === 'string' ? file['@_name'] : typeof file.name === 'string' ? file.name : '',
    urls: (Array.isArray(file.url) ? file.url : file.url ? [file.url] : []).map((url: unknown) => typeof url === 'string' ? url : typeof (url as { '#text'?: unknown })?.['#text'] === 'string' ? String((url as { '#text': unknown })['#text']) : '').filter(Boolean)
  }))
}

function getFileType(filename: string): TorrentFileInfo['type'] { const ext = filename.toLowerCase().slice(filename.lastIndexOf('.')); if (VIDEO_EXTENSIONS.includes(ext)) return 'video'; if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'; if (SUBTITLE_EXTENSIONS.includes(ext)) return 'subtitle'; return 'other' }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function isUnderRoot(root: string, path: string) { const rel = relative(resolve(root), resolve(path)); return !!rel && !rel.startsWith('..') && !isAbsolute(rel) }
function toNumber(value: string | undefined) { return Number(value || 0) || 0 }
function infoHashFromMagnet(value: string) { return value.match(/[?&]xt=urn:btih:([a-z\d]{32,40})/i)?.[1]?.toLowerCase() || '' }
// SRT 转 WebVTT 逻辑在 src/services/subtitle.ts（渲染层本地字幕复用同一实现）
import { srtToVtt } from '../src/services/subtitle'
// 由 infoHash 构造可分享的磁力链接（含名称与 tracker）；hash 尚未就绪（仍是 gid）时返回空串
function buildMagnetURI(hash: string, name: string, trackers: string[] = []) {
  if (!/^[a-z\d]{32,40}$/i.test(hash)) return ''
  const params = [`xt=urn:btih:${hash}`]
  if (name) params.push(`dn=${encodeURIComponent(name)}`)
  for (const tracker of trackers) params.push(`tr=${encodeURIComponent(tracker)}`)
  return `magnet:?${params.join('&')}`
}
function executablePath() {
  const name = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
  const bundled = app.isPackaged ? join(process.resourcesPath, 'aria2', name) : join(app.getAppPath(), 'resources', 'aria2', name)
  return process.env.ARIA2C_PATH || (existsSync(bundled) ? bundled : 'aria2c')
}
function trackerList(override = '') {
  // 优先级：设置页自定义 > ARIA2_TRACKERS 环境变量 > 内置快照
  const custom = (override || process.env.ARIA2_TRACKERS || '').split(/[\s,]+/).filter(Boolean)
  return (custom.length ? custom : DEFAULT_TRACKERS).join(',')
}

// aria2 的 RPC 不返回 infoHash，.torrent 文件在本地解析 info 字典并计算 sha1
function torrentInfoHash(filePath: string): string {
  let buf: Buffer
  try { buf = readFileSync(filePath) } catch { throw new Error('无法读取 torrent 文件') }
  const marker = Buffer.from('4:info')
  const idx = buf.indexOf(marker)
  if (idx < 0) throw new Error('无效的 torrent 文件')
  const start = idx + marker.length
  const end = bencodeEnd(buf, start)
  if (end <= start || end > buf.length) throw new Error('无效的 torrent 文件')
  return createHash('sha1').update(buf.subarray(start, end)).digest('hex')
}

// 返回 bencode 值从 start 开始的结束位置（不含）
function bencodeEnd(buf: Buffer, start: number): number {
  const c = buf[start]
  if (c === undefined) throw new Error('bad bencode')
  if (c === 0x69) { const e = buf.indexOf(0x65, start); if (e < 0) throw new Error('bad bencode'); return e + 1 }
  if (c === 0x6c || c === 0x64) {
    let pos = start + 1
    while (buf[pos] !== 0x65) {
      pos = bencodeEnd(buf, pos)
      if (c === 0x64) pos = bencodeEnd(buf, pos) // 字典：跳过键后还需跳过值
    }
    return pos + 1
  }
  const colon = buf.indexOf(0x3a, start)
  if (colon < 0) throw new Error('bad bencode')
  const len = Number(buf.subarray(start, colon).toString('ascii'))
  if (!Number.isFinite(len) || len < 0 || colon + 1 + len > buf.length) throw new Error('bad bencode')
  return colon + 1 + len
}

class TorrentEngine {
  private process: ChildProcessWithoutNullStreams | null = null
  private rpcUrl = ''
  private secret = randomBytes(16).toString('hex')
  private server: Server | null = null
  private serverPort = 0
  private statuses = new Map<string, AriaStatus>()
  private gidHashes = new Map<string, string>()
  private metadataGids = new Set<string>()
  private callbacks = new Map<string, (status: TorrentStatus) => void>()
  private timer: NodeJS.Timeout | null = null
  private dataDir = ''
  private startPromise: Promise<number> | null = null
  private streamToken = randomBytes(16).toString('hex')
  private destroying = false
  private spawning: Promise<void> | null = null
  private refreshing = false
  // 任务由“下载中”转为“已完成”时的回调（RSS 下载完成桌面通知用）
  private completeListener: ((infoHash: string, name: string) => void) | null = null
  // 全局状态广播：跨会话恢复的任务没有 per-task callback，靠它保证状态实时推送
  private globalListener: ((status: TorrentStatus) => void) | null = null
  private downloadDirOverride = ''
  private trackerOverride = ''
  private maxConcurrent = 0
  private speedLimit = ''
  // aria2 RPC 无响应计数（refreshStatuses 每秒一次，连续 10 次触发强制重启）
  private rpcFailCount = 0
  // 直链下载每服务器连接数（设置页可调，上限 16）
  private httpSplit = 8
  // yt-dlp 可执行文件路径（设置页指定；空则从 PATH 查找）
  private ytdlpPath = ''
  // 代理地址（http/socks）：仅直链与视频站点使用，BT/DHT 不走代理
  private proxy = ''
  // yt-dlp 的 cookies 来源浏览器（用户登录 YouTube 的浏览器；空则不带 cookies）
  private cookiesBrowser = ''
  // 任务持久化：key -> 任务来源。BT 用 infoHash，直链/视频任务用 sha1(source)；type 缺省 bt
  private taskSources = new Map<string, { source: string; done: boolean; type: TaskProtocol; name?: string; client?: string; noCookies?: boolean; filePath?: string }>()
  // 直链/视频任务的展示名（URL 文件名、视频标题）；BT 任务名来自 metadata
  private taskNames = new Map<string, string>()
  // yt-dlp 下载进程：任务 key -> 进程
  private videoProcs = new Map<string, ChildProcess>()
  private tasksFile = () => join(app.getPath('userData'), 'tasks.json')

  // 设置页写入的持久化配置：未启动时仅记录（spawn 时生效），已启动则热应用到 aria2
  configure(options: { downloadDir?: string; trackers?: string; maxConcurrentDownloads?: number; speedLimit?: string; httpSplit?: number; ytdlpPath?: string; proxy?: string; ytdlpBrowser?: string }) {
    if (options.downloadDir) {
      this.downloadDirOverride = options.downloadDir
      mkdirSync(options.downloadDir, { recursive: true })
      if (this.serverPort) void this.rpc('changeGlobalOption', [{ dir: options.downloadDir }]).catch((e) => logger.error('configure', 'dir failed: ' + getErrorMessage(e)))
    }
    if (options.trackers !== undefined) this.trackerOverride = options.trackers
    if (options.maxConcurrentDownloads && options.maxConcurrentDownloads > 0) {
      this.maxConcurrent = options.maxConcurrentDownloads
      if (this.serverPort) void this.rpc('changeGlobalOption', [{ 'max-concurrent-downloads': String(this.maxConcurrent) }]).catch((e) => logger.error('configure', 'max-concurrent failed: ' + getErrorMessage(e)))
    }
    // 限速全局生效（含正在下载的任务）：'0' 表示不限速
    if (options.speedLimit !== undefined) {
      this.speedLimit = options.speedLimit
      if (this.serverPort) void this.rpc('changeGlobalOption', [{ 'max-overall-download-limit': options.speedLimit }]).catch((e) => logger.error('configure', 'speed-limit failed: ' + getErrorMessage(e)))
    }
    // 直链分片数（每服务器连接数上限 16）；热应用对后续任务生效
    if (options.httpSplit && options.httpSplit > 0) {
      this.httpSplit = Math.min(16, Math.floor(options.httpSplit))
      if (this.serverPort) void this.rpc('changeGlobalOption', [{ split: String(this.httpSplit), 'max-connection-per-server': String(this.httpSplit) }]).catch((e) => logger.error('configure', 'http-split failed: ' + getErrorMessage(e)))
    }
    if (options.ytdlpPath !== undefined && options.ytdlpPath !== this.ytdlpPath) {
      this.ytdlpPath = options.ytdlpPath
      clearDetectCache()
    }
    if (options.proxy !== undefined) this.proxy = options.proxy.trim()
    if (options.ytdlpBrowser !== undefined) this.cookiesBrowser = options.ytdlpBrowser.trim()
  }

  effectiveDownloadDir() { return this.downloadDirOverride || this.dataDir || join(app.getPath('userData'), 'aria2-downloads') }

  onTorrentComplete(listener: (infoHash: string, name: string) => void) { this.completeListener = listener }

  onStatusBroadcast(listener: (status: TorrentStatus) => void) { this.globalListener = listener }

  private persistTasks() {
    try { writeJsonAtomic(this.tasksFile(), { tasks: [...this.taskSources].map(([hash, task]) => ({ hash, ...task })) }, 2) } catch (error) { logger.error('tasks', `persist failed: ${getErrorMessage(error)}`) }
  }

  private restoreTasks() {
    try {
      const raw = JSON.parse(readFileSync(this.tasksFile(), 'utf8')) as { tasks?: Array<{ hash: string; source: string; type?: TaskProtocol; name?: string; client?: string; noCookies?: boolean; filePath?: string; done?: boolean }> }
      for (const task of raw.tasks || []) {
        if (!task.source || this.taskSources.has(task.hash)) continue
        const type: TaskProtocol = task.type || 'bt'
        this.taskSources.set(task.hash, { source: task.source, done: !!task.done, type, name: task.name, client: task.client, noCookies: task.noCookies, filePath: task.filePath })
        if (task.name) this.taskNames.set(task.hash, task.name)
        logger.info('tasks', `restoring ${task.hash}${task.done ? ' (complete)' : ''}`)
        if (type === 'video') {
          // 视频任务重启后登记为暂停态（避免启动即访问第三方站点）；已完成的任务从磁盘重建文件列表
          let files: Array<{ index: string; path: string; length: string; completedLength: string; selected: string }> = []
          let total = '0'
          let state = 'paused'
          if (task.done && task.filePath) {
            try {
              const size = statSync(task.filePath).size
              files = [{ index: '1', path: task.filePath, length: String(size), completedLength: String(size), selected: 'true' }]
              total = String(size)
              state = 'complete'
            } catch { /* 文件已被移走：保持暂停态，用户可重新下载 */ }
          }
          this.applyStatus(task.hash, { gid: task.hash, status: state, totalLength: total, completedLength: total, downloadSpeed: '0', uploadSpeed: '0', connections: '0', dir: this.dataDir, files })
          continue
        }
        // 按持久化的类型直连恢复：web 类直链不再重复走 yt-dlp 探测
        const restore = type === 'bt' ? this.addTask(task.source, undefined, { wait: false }) : this.addDirect([task.source], undefined, { name: task.name })
        void restore.catch((error) => {
          logger.error('tasks', `restore failed for ${task.hash}: ${getErrorMessage(error)}`)
          this.taskSources.delete(task.hash)
          this.persistTasks()
        })
      }
    } catch { /* 尚无历史任务文件 */ }
  }

  async startServer() {
    if (this.serverPort) {
      if (!this.process) await this.spawnAria2()
      return this.serverPort
    }
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start()
    try { return await this.startPromise } finally { this.startPromise = null }
  }

  private async start(): Promise<number> {
    this.dataDir = this.downloadDirOverride || join(app.getPath('userData'), 'aria2-downloads')
    mkdirSync(this.dataDir, { recursive: true })
    this.server = createServer((request, response) => this.handleStream(request, response))
    await new Promise<void>((resolve, reject) => { this.server?.once('error', reject); this.server?.listen(0, '127.0.0.1', () => resolve()) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('无法启动本地媒体流服务')
    this.serverPort = address.port
    this.timer = setInterval(() => void this.refreshStatuses(), 1000)
    logger.cleanup()
    await this.spawnAria2()
    void this.restoreTasks()
    return this.serverPort
  }

  // aria2 进程与 HTTP 流服务解耦：进程崩溃后可单独重启，任务状态随旧会话清空
  private spawnAria2(): Promise<void> {
    if (this.process) return Promise.resolve()
    if (this.spawning) return this.spawning
    this.spawning = this.doSpawnAria2().finally(() => { this.spawning = null })
    return this.spawning
  }

  private async doSpawnAria2(): Promise<void> {
    const rpcPort = 20000 + Math.floor(Math.random() * 20000)
    const binary = executablePath()
    const env = { ...process.env }
    delete env.all_proxy
    delete env.ALL_PROXY
    if (process.platform === 'linux' && binary !== 'aria2c') env.LD_LIBRARY_PATH = `${dirname(binary)}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`
    const args = ['--enable-rpc=true', '--rpc-listen-all=false', `--rpc-listen-port=${rpcPort}`, `--rpc-secret=${this.secret}`, `--dir=${this.dataDir}`, '--continue=true', '--allow-overwrite=true', '--check-integrity=true', '--bt-enable-lpd=true', '--enable-dht=true', '--enable-peer-exchange=true', '--bt-enable-hook-after-hash-check=true', '--seed-time=0', '--file-allocation=none']
    // 部分网络屏蔽默认 DHT 引导节点，允许通过环境变量指定可达的引导入口
    if (process.env.ARIA2_DHT_ENTRY_POINT) args.push(`--dht-entry-point=${process.env.ARIA2_DHT_ENTRY_POINT}`)
    if (process.env.ARIA2_DHT_ENTRY_POINT6) args.push(`--dht-entry-point6=${process.env.ARIA2_DHT_ENTRY_POINT6}`)
    if (this.maxConcurrent) args.push(`--max-concurrent-downloads=${this.maxConcurrent}`)
    if (this.speedLimit) args.push(`--max-overall-download-limit=${this.speedLimit}`)
    const child = spawn(binary, args, { windowsHide: true, env })
    this.process = child
    let startupError = ''
    let spawnErrorCode: string | undefined
    child.stderr.on('data', (chunk) => { startupError += chunk.toString(); logger.error('aria2', chunk.toString().trim()) })
    child.on('error', (error: NodeJS.ErrnoException) => { spawnErrorCode = error.code; logger.error('aria2', 'process error: ' + getErrorMessage(error)) })
    child.on('exit', () => {
      this.process = null
      this.statuses.clear(); this.gidHashes.clear(); this.metadataGids.clear()
      if (this.destroying) return
      logger.error('aria2', '进程意外退出，正在重启…')
      void this.respawnAria2().then(() => this.restoreTasks())
    })
    this.rpcUrl = `http://127.0.0.1:${rpcPort}/jsonrpc`
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      try { await this.rpc('aria2.getVersion', []); return } catch (error) { if (this.process !== child) throw error; await new Promise((resolve) => setTimeout(resolve, 150)) }
    }
    this.process = null
    try { await this.rpc('aria2.getVersion', []) } catch { throw new Error(spawnErrorCode === 'ENOENT' ? '未找到 aria2c，请安装 aria2 或配置 ARIA2C_PATH' : `aria2 启动失败：${startupError || 'RPC 服务未响应'}`) }
  }

  private async respawnAria2(attempts = 3) {
    for (let i = 0; i < attempts && !this.destroying; i++) {
      try { await this.spawnAria2(); return } catch (error) { logger.error('aria2', '重启失败：' + getErrorMessage(error)); await new Promise((resolve) => setTimeout(resolve, 5000)) }
    }
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    let response: Response
    try {
      response = await fetch(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000), body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method.startsWith(`${RPC_VERSION}.`) ? method : `${RPC_VERSION}.${method}`, params: [`token:${this.secret}`, ...params] }) })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('aria2 RPC 请求超时', { cause: error })
      throw error
    }
    const body = await response.json() as RpcResponse<T>
    if (body.error) throw new Error(body.error.message)
    if (body.result === undefined) throw new Error('aria2 返回了空响应')
    return body.result
  }

  // 统一任务入口：按输入类型分流到 BT / 直链 / Metalink / 视频站点
  async addTask(input: string, onStatus?: (status: TorrentStatus) => void, opts: { wait?: boolean; dir?: string } = {}): Promise<TorrentStatus> {
    const kind = classifyInput(input)
    if (kind === 'magnet' || kind === 'torrent') return this.addTorrent(input, onStatus, opts)
    if (kind === 'metalink') return this.addMetalinkFile(input, onStatus, opts)
    if (kind === 'http' || kind === 'ftp') return this.addDirect([input.trim()], onStatus, opts)
    if (kind === 'web') {
      // 网页类 URL：yt-dlp 可用时先探测视频站点，探测失败（普通网页/网络错误）回退直链下载
      const url = input.trim()
      const probe = await this.probeVideo(url)
      if (probe) {
        // 同一 URL 之前被误回退为直链任务时：移除旧记录（含误下的 HTML 页面），重建为视频任务
        const key = stableKey(url)
        const existing = this.taskSources.get(key)
        if (existing && existing.type !== 'video') {
          logger.info('tasks', `rebuilding ${key.slice(0, 8)} as video task (was ${existing.type})`)
          await this.removeTorrent(key, true).catch(() => undefined)
        }
        return this.addVideo(url, probe, onStatus, opts)
      }
      return this.addDirect([url], onStatus, opts)
    }
    throw new Error('请输入磁力链接、.torrent/.metalink 文件或 http(s)/ftp 下载链接')
  }

  // yt-dlp 查找顺序：设置路径 > 应用内自动安装目录（userData/bin）> 系统 PATH
  private resolveYtdlp(): Promise<string | null> {
    return detectBinary(this.ytdlpPath || undefined, 'yt-dlp', join(app.getPath('userData'), 'bin'))
  }

  // JS 运行时（deno/node/bun）：yt-dlp 解 YouTube n 签名挑战所需，缺失时带 cookies 的会话会失败
  private async resolveJsRuntime(): Promise<string | undefined> {
    return jsRuntimeArg(await detectJsRuntime(join(app.getPath('userData'), 'bin')))
  }

  // 视频站点探测：按降级序列尝试——用户 cookies（web_safari 客户端）→ 无 cookies → 间隔重试 → android 保底
  // 关键：登录会话下必须显式指定 web_safari 客户端，默认客户端会降级到 360p；n 签名挑战需要 JS 运行时
  private async probeVideo(url: string): Promise<VideoProbe | null> {
    const binary = await this.resolveYtdlp()
    if (!binary) return null
    const cookies = this.cookiesBrowser || undefined
    const jsRuntime = await this.resolveJsRuntime()
    const base = { proxy: this.proxy || undefined, jsRuntime }
    // 已知视频站点域名：probe 失败时不回退直链（只会下载到 HTML 页面）
    const isVideoSite = /(?:youtube\.com|youtu\.be|bilibili\.com|b23\.tv)/i.test(url)
    const clean = (line: string) => line.replace(/^ERROR:\s*/, '').replace(/^\[[a-z]+\]\s*\S+:\s*/, '')
    const attempts: Array<{ cookiesBrowser?: string; client?: string; delay: number }> = [
      // 带 cookies 用 web_embedded,web_safari：可拿 4K，web_embedded 不可用时自动回退 web_safari(1080p)
      ...(cookies ? [{ cookiesBrowser: cookies, client: DEFAULT_COOKIE_CLIENT, delay: 0 }] : []),
      // 无 cookies（cookies 会话异常可能是失败源）；匿名默认客户端可拿到完整 DASH（含 1080p）
      { cookiesBrowser: undefined, delay: 5000 },
      // 默认客户端间隔重试：YouTube 的风控/格式受限状态会持续数十秒到几分钟，拉长窗口覆盖它
      // （android 客户端只有 360p，留作最后保底）
      { cookiesBrowser: undefined, delay: 10000 },
      { cookiesBrowser: undefined, delay: 20000 },
      { cookiesBrowser: undefined, delay: 30000 },
      { cookiesBrowser: undefined, client: 'android', delay: 5000 },
      { cookiesBrowser: undefined, client: 'android', delay: 10000 }
    ]
    let lastError = ''
    let sawBotCheck = false
    let sawCookieFail = false
    for (let i = 0; i < attempts.length; i++) {
      const { delay, ...attemptOpts } = attempts[i]
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
      const result = await probeVideoSite(binary, url, { ...base, ...attemptOpts })
      if (result.cookieFail) { sawCookieFail = true; continue }
      if (result.probe && !result.restricted) {
        if (sawCookieFail) logger.warn('ytdlp', 'cookies unavailable (browser locked?), proceeding without cookies')
        if (!attempts[i].cookiesBrowser) result.probe.noCookies = true
        return result.probe
      }
      sawBotCheck = sawBotCheck || result.botCheck
      lastError = result.errorLine || lastError
    }
    if (sawCookieFail) logger.warn('ytdlp', 'cookies unavailable (browser locked?), proceeding without cookies')
    if (sawBotCheck) throw new Error('YouTube 要求登录验证：请在设置页选择已登录 YouTube 的浏览器（Cookies）后重试')
    if (lastError && /video unavailable|private video|removed|not available|terminated|copyright/i.test(lastError)) {
      throw new Error(clean(lastError) || '视频不可用')
    }
    if (isVideoSite) throw new Error('视频解析失败：' + (clean(lastError) || '站点返回异常，请稍后重试'))
    return null
  }

  // 直链下载（HTTP/HTTPS/FTP）：uris 为同一资源的多个镜像，aria2 会自动切换
  private async addDirect(uris: string[], onStatus?: (status: TorrentStatus) => void, opts: { dir?: string; name?: string } = {}) {
    await this.startServer()
    const url = uris[0]
    const key = stableKey(url)
    const existing = this.statuses.get(key)
    if (existing) {
      if (onStatus) this.callbacks.set(key, onStatus)
      return this.toTorrentStatus(key, existing)
    }
    const type: TaskProtocol = /^ftp:\/\//i.test(url) ? 'ftp' : 'http'
    // 直链任务走代理（设置页配置）；BT/DHT 不走代理，故不设全局
    const options = { split: String(this.httpSplit), 'max-connection-per-server': String(this.httpSplit), 'min-split-size': '1M', ...(this.proxy ? { 'all-proxy': this.proxy } : {}), ...(opts.dir ? { dir: opts.dir } : {}) }
    const gid = await this.rpc<string>('addUri', [uris, options])
    // 保留已有条目的 done/name（aria2 重启恢复已完成任务时不丢标记）
    const prevTask = this.taskSources.get(key)
    this.taskSources.set(key, { source: url, done: prevTask?.done || false, type, name: opts.name || prevTask?.name })
    this.taskNames.set(key, opts.name || prevTask?.name || directName(url))
    this.persistTasks()
    const status = await this.refreshGid(gid, key, onStatus)
    return this.toTorrentStatus(key, status)
  }

  // Metalink：本地解析 XML，每个 <file> 展开为一个直链任务（多 <url> 作为镜像交给 aria2 切换）
  private async addMetalinkFile(input: string, onStatus?: (status: TorrentStatus) => void, opts: { dir?: string } = {}) {
    let xml: string
    try { xml = readFileSync(input.trim(), 'utf8') } catch { throw new Error('无法读取 metalink 文件') }
    const entries = parseMetalink(xml)
    if (!entries.length) throw new Error('metalink 文件中没有可下载的条目')
    const first: TorrentStatus[] = []
    for (const entry of entries) {
      const urls = entry.urls.filter((url) => /^(https?|ftp):\/\//i.test(url))
      if (!urls.length) continue
      first.push(await this.addDirect(urls, onStatus, { ...opts, name: entry.name || undefined }))
    }
    if (!first.length) throw new Error('metalink 条目中没有有效的 http(s)/ftp 链接')
    return first[0]
  }

  // 视频站点任务：yt-dlp 解析标题与大小，下载进程的 stdout 映射为任务进度
  private async addVideo(url: string, probe: VideoProbe, onStatus?: (status: TorrentStatus) => void, opts: { dir?: string } = {}) {
    await this.startServer()
    const key = stableKey(url)
    const existing = this.statuses.get(key)
    if (existing) {
      if (onStatus) this.callbacks.set(key, onStatus)
      return this.toTorrentStatus(key, existing)
    }
    const dir = opts.dir || this.dataDir
    this.taskSources.set(key, { source: url, done: false, type: 'video', name: probe.title, client: probe.client, noCookies: probe.noCookies })
    this.taskNames.set(key, probe.title)
    this.persistTasks()
    // 合成与 aria2 一致的状态结构，复用推送、展示与持久化链路
    this.applyStatus(key, { gid: key, status: 'active', totalLength: String(probe.size || 0), completedLength: '0', downloadSpeed: '0', uploadSpeed: '0', connections: '1', dir, files: [{ index: '1', path: join(dir, sanitizeFilename(probe.title, probe.ext)), length: String(probe.size || 0), completedLength: '0', selected: 'true' }] })
    if (onStatus) this.callbacks.set(key, onStatus)
    this.startVideoDownload(key, url, dir)
    return this.toTorrentStatus(key, this.statuses.get(key)!)
  }

  // attempt 记录降级进度：useCookies（本次是否带 cookies）→ client（android 兜底）→ retries（间隔重试）
  private startVideoDownload(key: string, url: string, dir: string, attempt: { useCookies?: boolean; client?: string; retries?: number } = {}) {
    void (async () => {
      const binary = await this.resolveYtdlp()
      const status = this.statuses.get(key)
      if (!status) return
      // applyStatus 以内容比较去重：必须传新对象，原地 mutate 会被判定为无变化而不推送
      if (!binary) { this.applyStatus(key, { ...status, status: 'error', errorMessage: '未找到 yt-dlp，可在设置中自动安装或配置路径' }); return }
      // ffmpeg 检测含应用内安装目录（userData/bin）；无 ffmpeg 时只能选预合并的单文件格式
      const ffmpegBinary = await detectBinary(undefined, 'ffmpeg', join(app.getPath('userData'), 'bin'))
      const format = videoFormat(!!ffmpegBinary)
      // ffmpeg 不在 PATH 时（应用内安装），显式告知 yt-dlp 合并工具位置
      const ffmpegLocation = ffmpegBinary ? dirname(ffmpegBinary) : undefined
      const jsRuntime = await this.resolveJsRuntime()
      const task = this.taskSources.get(key)
      // probe 阶段确定的配置（client / 是否带 cookies）；重试可覆盖
      const useCookies = attempt.useCookies ?? (!task?.noCookies && !!this.cookiesBrowser)
      const cookiesBrowser = useCookies ? this.cookiesBrowser || undefined : undefined
      // 带 cookies 时用 web_embedded,web_safari：web_embedded 能给到 4K（vp9/av01），
      // 但它对部分视频不可用，此时自动回退到 web_safari（最高 1080p 的 HLS 单文件）。
      // 去 cookies 后必须同时去掉该客户端（匿名会话用默认客户端才能拿到完整 DASH）
      const client = attempt.client ?? (useCookies ? task?.client || DEFAULT_COOKIE_CLIENT : undefined)
      // 音视频分流下载时进度会回跳，按当前流的最大值展示保证单调
      let maxPercent = 0
      const child = spawnYtdlpDownload(binary, url, dir, format, {
        onLine: (line) => {
          const current = this.statuses.get(key)
          if (!current) return
          const progress = parseProgressLine(line)
          if (progress) {
            maxPercent = Math.max(maxPercent, progress.percent)
            const total = progress.totalSize || toNumber(current.totalLength)
            const completed = Math.round(total * maxPercent / 100)
            // 文件级进度同步更新：列表页按 files[].completed/size 渲染，不更新会一直显示 0%
            const files = current.files?.length ? [{ ...current.files[0], length: String(total), completedLength: String(completed) }] : current.files
            this.applyStatus(key, { ...current, status: 'active', totalLength: String(total), completedLength: String(completed), files, ...(progress.speed ? { downloadSpeed: String(Math.round(progress.speed)) } : {}) })
          } else if (/^\[download\]\s+Destination:/i.test(line)) {
            // 新的流（视频→音频）开始：进度重置；恢复的任务此时补齐文件占位
            maxPercent = 0
            const dest = line.replace(/^\[download\]\s+Destination:\s*/i, '').trim()
            if (dest) {
              const files = current.files?.length ? [{ ...current.files[0], path: dest }] : [{ index: '1', path: dest, length: current.totalLength, completedLength: '0', selected: 'true' }]
              this.applyStatus(key, { ...current, files })
            }
          } else if (/^(?:[A-Za-z]:[\\/]|\/)/.test(line)) {
            // --print after_move:filepath 的最终路径：修正预期文件名（yt-dlp 会清理非法字符）
            // 恢复的任务 files 为空（秒完成时没有 Destination 行），这里必须创建条目
            const finalPath = line.trim()
            const files = current.files?.length ? [{ ...current.files[0], path: finalPath }] : [{ index: '1', path: finalPath, length: current.totalLength, completedLength: current.completedLength, selected: 'true' }]
            this.taskNames.set(key, basename(finalPath))
            const task = this.taskSources.get(key)
            if (task && task.filePath !== finalPath) { task.filePath = finalPath; this.persistTasks() }
            this.applyStatus(key, { ...current, files })
          }
        },
        onExit: (code, tail) => {
          this.videoProcs.delete(key)
          const current = this.statuses.get(key)
          if (!current) return
          if (code === 0) {
            // 成功后以磁盘上的真实文件为准：DASH 分流下载时进度里的 totalLength 只是单条流的大小，
            // 合并后的成品大小需重新 stat；同时补齐文件级 length/completedLength，列表页才会显示 100%
            const filePath = current.files?.[0]?.path
            let size = toNumber(current.totalLength) || toNumber(current.completedLength)
            if (filePath) { try { size = statSync(filePath).size } catch { /* 文件已被移走时沿用进度值 */ } }
            const files = current.files?.length
              ? [{ ...current.files[0], length: String(size), completedLength: String(size) }]
              : filePath ? [{ index: '1', path: filePath, length: String(size), completedLength: String(size), selected: 'true' }] : current.files
            this.applyStatus(key, { ...current, status: 'complete', totalLength: String(size), completedLength: String(size), downloadSpeed: '0', files })
            return
          }
          if (current.status === 'paused') return
          const tailAll = tail || ''
          const tailLine = tailAll.trim().split('\n').pop() || ''
          const step = (patch: { useCookies?: boolean; client?: string; retries?: number }) => this.startVideoDownload(key, url, dir, { ...attempt, ...patch })
          // 降级序列与 probe 一致：cookies 失效/读取失败 → 去 cookies → android 客户端 → 间隔重试
          if (/cookie|dpapi/i.test(tailAll) && useCookies) {
            logger.info('ytdlp', `cookies unavailable on ${key.slice(0, 8)}, retrying without cookies`)
            step({ useCookies: false })
            return
          }
          // 站点错误（视频不可用等）：带 cookies 时的失败可能是 cookies 会话异常导致，去 cookies 重试一次
          if (/video unavailable|private video|removed|not available|terminated|copyright/i.test(tailLine) && useCookies) {
            logger.info('ytdlp', `site error on ${key.slice(0, 8)}, retrying without cookies`)
            step({ useCookies: false })
            return
          }
          // 风控/格式受限统一降级：默认客户端间隔重试优先（随机触发，重试常能过），android 只有 360p 留作保底
          if (/sign in to confirm/i.test(tailAll) || tailLine.includes('Requested format is not available')) {
            const isBotCheck = /sign in to confirm/i.test(tailAll)
            const label = isBotCheck ? 'bot check' : 'format restricted'
            if (useCookies) {
              logger.info('ytdlp', `${label} on ${key.slice(0, 8)}, retrying without cookies`)
              step({ useCookies: false })
              return
            }
            if (!attempt.client) {
              const retries = attempt.retries || 0
              if (retries < 4) {
                const delay = [10000, 20000, 30000, 60000][retries]
                logger.info('ytdlp', `${label} on ${key.slice(0, 8)}, retry ${retries + 1}/4 in ${delay / 1000}s`)
                // 重试等待期显示"连接中"，避免任务看起来假死在"下载中 0%"
                this.applyStatus(key, { ...current, status: 'connecting' })
                setTimeout(() => step({ retries: retries + 1 }), delay)
                return
              }
              logger.info('ytdlp', `${label} persists on ${key.slice(0, 8)}, falling back to android client (360p)`)
              step({ client: 'android', retries: 0 })
              return
            }
            const retries = attempt.retries || 0
            if (retries < 1) {
              logger.info('ytdlp', `${label} persists on android ${key.slice(0, 8)}, retry 1/1 in 15s`)
              this.applyStatus(key, { ...current, status: 'connecting' })
              setTimeout(() => step({ retries: retries + 1 }), 15000)
              return
            }
            if (isBotCheck) this.applyStatus(key, { ...current, status: 'error', errorMessage: 'YouTube 要求登录验证：请在设置页选择已登录 YouTube 的浏览器（Cookies）后重试' })
            else {
              void (async () => {
                const hasFfmpeg = !!(await detectBinary(undefined, 'ffmpeg', join(app.getPath('userData'), 'bin')))
                const hasJsRuntime = !!(await detectJsRuntime(join(app.getPath('userData'), 'bin')))
                const current = this.statuses.get(key)
                if (!current) return
                this.applyStatus(key, { ...current, status: 'error', errorMessage: !hasJsRuntime
                  ? '视频格式受限：缺少 JS 运行时（deno/node），无法解 YouTube 签名挑战，请在设置页一键安装 deno'
                  : hasFfmpeg
                    ? '视频格式暂时受限：多次重试后仍无可下载格式，请稍后点“恢复”重试'
                    : '视频格式受限：该资源没有音视频合一的格式，需要安装 ffmpeg 合并分离流（设置页可一键安装）' })
              })()
            }
            return
          }
          this.applyStatus(key, { ...current, status: 'error', errorMessage: tailLine ? `yt-dlp 退出码 ${code}：${tailLine}` : `yt-dlp 退出码 ${code}` })
        },
        onError: (error) => {
          this.videoProcs.delete(key)
          const current = this.statuses.get(key)
          if (!current) return
          this.applyStatus(key, { ...current, status: 'error', errorMessage: getErrorMessage(error) })
        }
      }, { proxy: this.proxy || undefined, ffmpegLocation, cookiesBrowser, client, jsRuntime })
      this.videoProcs.set(key, child)
    })()
  }

  private pauseVideo(key: string) {
    const status = this.statuses.get(key)
    if (status) this.applyStatus(key, { ...status, status: 'paused', downloadSpeed: '0' })
    const child = this.videoProcs.get(key)
    if (child) { child.kill(); this.videoProcs.delete(key) }
  }

  private resumeVideo(key: string) {
    const task = this.taskSources.get(key)
    const status = this.statuses.get(key)
    if (!task || !status) throw new Error('下载任务不存在')
    if (status.status === 'complete') return
    this.applyStatus(key, { ...status, status: 'active' })
    this.startVideoDownload(key, task.source, status.dir || this.dataDir)
  }

  // ffmpeg 等依赖就绪后调用：自动重试所有出错的视频任务
  retryErroredVideos() {
    for (const [key, task] of this.taskSources) {
      if (task.type !== 'video') continue
      const status = this.statuses.get(key)
      if (status?.status === 'error') {
        logger.info('ytdlp', `auto-retrying errored video task ${key.slice(0, 8)}`)
        this.resumeVideo(key)
      }
    }
  }

  private removeVideo(key: string, destroy: boolean) {
    const child = this.videoProcs.get(key)
    if (child) { child.kill(); this.videoProcs.delete(key) }
    const status = this.statuses.get(key)
    this.statuses.delete(key)
    this.callbacks.delete(key)
    this.taskSources.delete(key)
    this.taskNames.delete(key)
    this.persistTasks()
    if (destroy && status) {
      this.removeTaskFiles(status)
      // yt-dlp 的 .part 续传文件一并清理
      for (const file of status.files || []) { try { rmSync(`${file.path}.part`, { force: true }) } catch { /* 清理失败不影响移除 */ } }
    }
  }

  async addTorrent(torrentId: string, onStatus?: (status: TorrentStatus) => void, opts: { wait?: boolean; dir?: string } = {}) {
    await this.startServer()
    const id = torrentId.trim()
    const isTorrentFile = id.toLowerCase().endsWith('.torrent')
    if (!id.startsWith('magnet:?') && !isTorrentFile) throw new Error('请输入有效的磁力链接或 torrent 文件路径')
    // .torrent 自带 metadata：本地算出真实 infoHash，并用 pause 入库，等用户选择后再下载
    const hash = isTorrentFile ? torrentInfoHash(id) : infoHashFromMagnet(id)
    if (hash && this.statuses.has(hash)) {
      if (onStatus) this.callbacks.set(hash, onStatus)
      const existing = this.statuses.get(hash)!
      if (!existing.files?.length) await this.waitForMetadata(hash)
      return this.toTorrentStatus(hash, this.statuses.get(hash) || existing)
    }
    // dir：任务级保存目录（RSS 按季归类用），覆盖全局下载目录
    const options = { 'seed-time': '0', 'bt-tracker': trackerList(this.trackerOverride), ...(opts.dir ? { dir: opts.dir } : {}), ...(isTorrentFile ? { pause: 'true' } : { 'pause-metadata': 'true', 'bt-save-metadata': 'true' }) }
    const gid = await this.rpc<string>('addUri', [[id], options])
    if (!isTorrentFile) this.metadataGids.add(gid)
    const first = await this.refreshGid(gid, hash || gid, onStatus)
    const key = first.bittorrent?.infoHash?.toLowerCase() || hash || gid
    if (key !== gid) {
      this.gidHashes.set(gid, key)
      if (onStatus) this.callbacks.set(key, onStatus)
    }
    this.taskSources.set(key, { source: id, done: false, type: 'bt' })
    this.persistTasks()
    if (isTorrentFile) return this.toTorrentStatus(key, first)
    if (opts.wait !== false) await this.waitForMetadata(key)
    const status = this.statuses.get(key.toLowerCase()) || this.statuses.get(key)
    if (!status) throw new Error('下载任务正在解析，请稍候')
    return this.toTorrentStatus(key, status)
  }

  private async waitForMetadata(hash: string, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs
    let metadataAt = 0
    while (Date.now() < deadline) {
      const status = this.statuses.get(hash.toLowerCase()) || this.statuses.get(hash)
      if (status?.status === 'error') return
      // 真实文件列表已就位（后续任务已接管）时立即返回；父任务帧可能带 [METADATA] 占位文件，需排除
      if (status && status.files?.length && !this.metadataGids.has(status.gid) && !status.followedBy?.length) return
      if (status?.bittorrent?.info?.name) {
        // metadata 已到达：稍等后续任务接管，用真实文件列表替换 [METADATA] 占位
        if (!status.followedBy?.length) {
          if (!metadataAt) metadataAt = Date.now()
          if (Date.now() - metadataAt > 2500) return
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }

  async downloadTorrent(infoHash: string, filePaths?: string[]) {
    let status = await this.findStatus(infoHash)
    const task = this.taskSources.get(infoHash.toLowerCase()) || this.taskSources.get(infoHash)
    // 视频任务由 yt-dlp 全程管理：未在下载中时重新拉起（续传 .part），无需选择文件
    if (task?.type === 'video') {
      if (!this.videoProcs.has(status.gid) && status.status !== 'complete' && status.status !== 'error') this.startVideoDownload(status.gid, task.source, status.dir || this.dataDir)
      return
    }
    // 命中的可能是 metadata 父任务（complete、由后续任务接管展示）：转而操作真正的下载任务
    if (status.followedBy?.length) status = await this.refreshGid(status.followedBy[0], infoHash.toLowerCase())
    const files = status.files || []
    if (!files.length) throw new Error('种子文件信息尚未准备完成')
    let indexes = files.map((file) => file.index)
    if (filePaths?.length) {
      indexes = files.filter((file) => filePaths.includes(file.path) || filePaths.includes(basename(file.path))).map((file) => file.index)
      if (!indexes.length) throw new Error('未找到指定的媒体文件')
    }
    // 已完成的任务无需也无法再改选项，文件本身已在磁盘上
    if (status.status !== 'complete') {
      await this.rpc('changeOption', [status.gid, { 'select-file': indexes.join(',') }])
      // changeOption 的 pause 选项不会解除暂停，必须显式 unpause
      await this.rpc('unpause', [status.gid]).catch(() => undefined)
    }
    await this.refreshGid(status.gid, infoHash)
  }
  async pauseTorrent(infoHash: string) {
    const status = await this.findStatus(infoHash)
    if (this.taskSources.get(status.gid)?.type === 'video' || this.taskSources.get(infoHash.toLowerCase())?.type === 'video') return this.pauseVideo(infoHash.toLowerCase())
    await this.rpc('pause', [status.gid]); await this.refreshGid(status.gid, infoHash)
  }
  async resumeTorrent(infoHash: string) {
    const status = await this.findStatus(infoHash)
    if (this.taskSources.get(status.gid)?.type === 'video' || this.taskSources.get(infoHash.toLowerCase())?.type === 'video') return this.resumeVideo(infoHash.toLowerCase())
    await this.rpc('unpause', [status.gid]); await this.refreshGid(status.gid, infoHash)
  }
  async removeTorrent(infoHash: string, destroy = false) {
    const task = this.taskSources.get(infoHash.toLowerCase()) || this.taskSources.get(infoHash)
    if (task?.type === 'video') return this.removeVideo(infoHash.toLowerCase(), destroy)
    const status = await this.findStatus(infoHash)
    const hash = infoHash.toLowerCase()
    // 连带清理同属这个资源的所有 gid（metadata 父任务 + 后续任务），防止移除后子任务以 gid 形式复活
    const gids = new Set<string>([status.gid])
    for (const [gid, h] of this.gidHashes) if (h === hash || h === infoHash) gids.add(gid)
    for (const gid of gids) {
      // remove 用于活动/暂停中的任务，removeDownloadResult 用于已停止任务的记录清理；各司其职、互为兜底
      await this.rpc('remove', [gid]).catch(() => undefined)
      await this.rpc('removeDownloadResult', [gid]).catch(() => undefined)
      this.metadataGids.delete(gid)
    }
    this.statuses.delete(infoHash)
    this.statuses.delete(hash)
    this.callbacks.delete(infoHash)
    this.callbacks.delete(hash)
    this.taskSources.delete(hash)
    this.taskSources.delete(infoHash)
    this.persistTasks()
    for (const gid of gids) this.gidHashes.delete(gid)
    if (destroy) this.removeTaskFiles(status)
  }

  private removeTaskFiles(status: AriaStatus) {
    const root = resolve(this.dataDir)
    const dirs = new Set<string>()
    for (const file of status.files || []) {
      const path = resolve(file.path)
      if (!isUnderRoot(root, path)) continue
      try { rmSync(path, { force: true }) } catch { /* 单个文件删除失败时继续清理其余文件 */ }
      dirs.add(dirname(path))
    }
    for (const dir of dirs) {
      let current = dir
      while (isUnderRoot(root, current)) {
        try { rmdirSync(current) } catch { break }
        current = dirname(current)
      }
    }
  }
  getAllStatuses() { return [...this.statuses.entries()].map(([hash, status]) => this.toTorrentStatus(hash, status)) }
  getStreamUrl(infoHash: string, filePath: string) { const hash = infoHash.toLowerCase(); const status = this.statuses.get(hash); const fileIndex = status?.files?.find((file) => file.path === filePath || basename(file.path) === filePath)?.index; if (!status || !fileIndex) throw new Error('媒体文件尚未准备完成'); return `http://127.0.0.1:${this.serverPort}/stream/${encodeURIComponent(hash)}/${fileIndex}?token=${this.streamToken}` }

  // 返回可挂载到 <track> 的字幕 URL：仅支持 .srt/.vtt，主进程会实时把 srt 转成 vtt
  getSubtitleUrl(infoHash: string, filePath: string) {
    const hash = infoHash.toLowerCase()
    const status = this.statuses.get(hash)
    const file = status?.files?.find((item) => item.path === filePath || basename(item.path) === filePath)
    const ext = file ? file.path.toLowerCase().slice(file.path.lastIndexOf('.')) : ''
    if (!status || !file || !ATTACHABLE_SUBTITLES.includes(ext)) throw new Error('字幕文件不存在或格式不支持')
    return `http://127.0.0.1:${this.serverPort}/subtitle/${encodeURIComponent(hash)}/${file.index}?token=${this.streamToken}`
  }

  private async refreshStatuses() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const active = await this.rpc<AriaStatus[]>('tellActive', []).catch(() => null)
      // RPC 无响应计数：进程活着但事件循环卡死（CLOSE_WAIT 堆积）时，连续失败约 10 秒强制重启；
      // exit handler 会自动 respawn 并恢复任务
      if (active === null) {
        this.rpcFailCount++
        if (this.rpcFailCount >= 10 && this.process && !this.destroying) {
          logger.error('aria2', `RPC 连续 ${this.rpcFailCount} 次无响应，强制重启 aria2`)
          this.rpcFailCount = 0
          try { this.process.kill() } catch { /* 进程已退出 */ }
        }
        return
      }
      this.rpcFailCount = 0
      const waiting = await this.rpc<AriaStatus[]>('tellWaiting', [0, 1000]).catch(() => [])
      const stopped = await this.rpc<AriaStatus[]>('tellStopped', [0, 1000]).catch(() => [])
      for (const status of [...active, ...waiting, ...stopped]) {
        // aria2 的 tellStatus 不返回 infoHash：磁力任务的哈希来自 URI，后续任务从父任务的 followedBy 反查
        let hash = status.bittorrent?.infoHash?.toLowerCase() || this.gidHashes.get(status.gid)
        if (!hash && status.belongsTo) hash = this.gidHashes.get(status.belongsTo)
        if (!hash) hash = [...this.statuses.entries()].find(([, item]) => item.gid === status.gid)?.[0] || status.gid
        this.gidHashes.set(status.gid, hash)
        for (const childGid of status.followedBy || []) this.gidHashes.set(childGid, hash)
        // metadata 下载任务完成后由后续任务接管展示，避免覆盖真实文件列表
        if (status.followedBy?.length && status.status !== 'active') {
          this.metadataGids.delete(status.gid)
          continue
        }
        if (status.status === 'error') this.metadataGids.delete(status.gid)
        // 批量结果已含全部字段，直接落库，避免对每个任务再发一次 tellStatus
        this.applyStatus(hash, status)
      }
      // 清理幽灵拷贝：任务迁移到 hash key 后遗留的旧 gid key 条目
      for (const [key, item] of this.statuses) {
        const mapped = this.gidHashes.get(item.gid)
        if (key === item.gid && mapped && mapped !== item.gid) this.statuses.delete(key)
      }
    } finally { this.refreshing = false }
  }
  private applyStatus(hash: string, status: AriaStatus) {
    const prev = this.statuses.get(hash)
    this.statuses.set(hash, status)
    const task = this.taskSources.get(hash)
    // 完成边沿检测：仅在本地跟踪的任务首次完成时触发，恢复的历史完成任务（prev 为空）不通知
    if (prev && prev.status !== 'complete' && status.status === 'complete' && task && !task.done) {
      task.done = true
      this.persistTasks()
      this.completeListener?.(hash, status.bittorrent?.info?.name || this.taskNames.get(hash) || status.info || hash)
    }
    const key = this.taskSources.has(hash) ? hash : this.taskSources.has(hash.toLowerCase()) ? hash.toLowerCase() : ''
    const entry = key ? this.taskSources.get(key)! : undefined
    // 首次到达 complete 时把任务标记为已完整下载，重启恢复时会自动校验复用数据
    if (status.status === 'complete' && entry && !entry.done) {
      entry.done = true
      this.persistTasks()
      logger.info('tasks', `download complete: ${hash}`)
    }
    // 内容没有变化时不触发推送，避免渲染层每秒整体重渲染
    if (prev && JSON.stringify(prev) === JSON.stringify(status)) return
    const listener = this.callbacks.get(hash) || this.callbacks.get(hash.toLowerCase()) || this.globalListener
    if (listener) listener(this.toTorrentStatus(hash, status))
  }
  private async refreshGid(gid: string, hash: string, callback?: (status: TorrentStatus) => void): Promise<AriaStatus> { const status = await this.rpc<AriaStatus>('tellStatus', [gid, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'dir', 'bittorrent', 'followedBy', 'belongsTo', 'files']]); this.gidHashes.set(gid, hash); if (callback) this.callbacks.set(hash, callback); this.applyStatus(hash, status); return status }
  private async findStatus(infoHash: string) { const hash = infoHash.toLowerCase(); const existing = this.statuses.get(hash); if (existing) return existing; await this.refreshStatuses(); const found = this.statuses.get(hash); if (!found) throw new Error('下载任务不存在'); return found }
  private toTorrentStatus(hash: string, status: AriaStatus): TorrentStatus {
    const task = this.taskSources.get(hash) || this.taskSources.get(hash.toLowerCase())
    const type: TaskProtocol = task?.type || 'bt'
    const totalSize = toNumber(status.totalLength) || (status.files || []).reduce((sum, file) => sum + toNumber(file.length), 0)
    const downloaded = toNumber(status.completedLength)
    const downloadSpeed = toNumber(status.downloadSpeed)
    const files = (status.files || []).map((file) => ({ name: relative(status.dir || this.dataDir, file.path) || basename(file.path), path: file.path, size: toNumber(file.length), completed: toNumber(file.completedLength), type: getFileType(file.path) }))
    const name = status.bittorrent?.info?.name || this.taskNames.get(hash) || this.taskNames.get(hash.toLowerCase()) || status.info || hash
    // 磁力链接只对 BT 任务有意义：直链任务的 key 是 sha1(url)，不是 btih 哈希
    const magnetURI = type === 'bt' ? buildMagnetURI(hash, name, trackerList(this.trackerOverride).split(',')) : ''
    const state: TorrentStatus['status'] = status.status === 'error' ? 'error' : this.metadataGids.has(status.gid) ? 'parsing' : status.status === 'paused' ? 'paused' : status.status === 'complete' ? 'seeding' : status.status === 'active' ? 'downloading' : 'connecting'
    return { infoHash: hash, name, magnetURI, progress: totalSize ? downloaded / totalSize : 0, downloadSpeed, uploadSpeed: toNumber(status.uploadSpeed), downloaded, totalSize, numPeers: toNumber(status.connections), timeRemaining: downloadSpeed > 0 ? Math.ceil(((totalSize - downloaded) / downloadSpeed) * 1000) : 0, status: state, uploaded: toNumber(status.uploadLength), saveDir: status.dir || '', type, sourceUrl: type === 'bt' ? undefined : task?.source, error: state === 'error' ? status.errorMessage || '任务出错' : undefined, files }
  }

  private handleStream(request: IncomingMessage, response: ServerResponse) {
    let url: URL
    try { url = new URL(request.url || '/', `http://127.0.0.1:${this.serverPort}`) } catch { response.writeHead(400); response.end(); return }
    // 随机 token 防止本机其它进程或浏览器页面（CSRF/DNS rebinding）读取下载内容
    if (url.searchParams.get('token') !== this.streamToken) { response.writeHead(403); response.end(); return }
    // 渲染层用 fetch 探测数据就绪状态（跨源），需要放行 CORS 预检；安全性由 token 保证
    if (request.method === 'OPTIONS') { response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'range' }); response.end(); return }
    const cors = { 'access-control-allow-origin': '*' }
    const match = url.pathname.match(/^\/stream\/([^/]+)\/(\d+)$/)
    if (!match) { response.writeHead(404, cors); response.end(); return }
    // 字幕路由：srt 在内存中转成 vtt 后整体返回（字幕文件都很小，无需 Range）
    const subtitleMatch = url.pathname.match(/^\/subtitle\/([^/]+)\/(\d+)$/)
    if (subtitleMatch) {
      const hash = decodeURIComponent(subtitleMatch[1])
      const status = this.statuses.get(hash)
      const file = status?.files?.find((item) => item.index === subtitleMatch[2])
      const ext = file ? file.path.toLowerCase().slice(file.path.lastIndexOf('.')) : ''
      if (!file || !ATTACHABLE_SUBTITLES.includes(ext)) { response.writeHead(404, cors); response.end('Subtitle not found'); return }
      const path = resolve(file.path)
      if (!isUnderRoot(resolve(status!.dir || this.dataDir), path)) { response.writeHead(403, cors); response.end(); return }
      let body: Buffer
      try { body = Buffer.from(srtToVtt(readFileSync(path, 'utf8')), 'utf8') } catch { response.writeHead(404, cors); response.end('File not ready'); return }
      response.writeHead(200, { ...cors, 'content-type': 'text/vtt; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
      response.end(body)
      return
    }
    const hash = decodeURIComponent(match[1])
    const status = this.statuses.get(hash)
    if (!status) { response.writeHead(404, cors); response.end('Task not found'); return }
    const file = status.files?.find((item) => item.index === match[2])
    if (!file) { response.writeHead(404, cors); response.end('File not found'); return }
    const root = resolve(status.dir || this.dataDir)
    const path = resolve(file.path)
    if (!isUnderRoot(root, path)) { response.writeHead(403, cors); response.end(); return }
    let fileStat: ReturnType<typeof statSync>
    try { fileStat = statSync(path) } catch { response.writeHead(404, cors); response.end('File not ready'); return }
    const size = fileStat.size
    let start = 0
    let end = size - 1
    const rangeHeader = request.headers.range
    if (rangeHeader) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
      // 只处理单一范围；bytes=-N 为后缀范围（最后 N 字节）
      if (!range || (range[1] === '' && range[2] === '')) { response.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }); response.end(); return }
      if (range[1] === '') start = Math.max(0, size - Number(range[2]))
      else {
        start = Number(range[1])
        if (range[2] !== '') end = Math.min(Number(range[2]), size - 1)
      }
      if (start > end || start >= size) { response.writeHead(416, { ...cors, 'content-range': `bytes */${size}` }); response.end(); return }
    }
    response.writeHead(rangeHeader ? 206 : 200, { ...cors, 'content-type': getMime(path), 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(rangeHeader ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) })
    createReadStream(path, { start, end }).pipe(response)
  }

  async destroy() {
    this.destroying = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const [, child] of this.videoProcs) { try { child.kill() } catch { /* 进程已退出 */ } }
    this.videoProcs.clear()
    if (this.process) {
      const child = this.process
      await new Promise<void>((resolve) => {
        const forceTimer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 进程已退出 */ } }, 3000)
        child.once('exit', () => { clearTimeout(forceTimer); resolve() })
        child.kill()
      })
    }
    this.server?.close()
    this.server = null
    this.serverPort = 0
    this.statuses.clear(); this.gidHashes.clear(); this.metadataGids.clear(); this.callbacks.clear()
    this.process = null
  }
}
function getMime(filename: string) { const ext = filename.toLowerCase().slice(filename.lastIndexOf('.')); return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg' } as Record<string, string>)[ext] || 'application/octet-stream' }
export const torrentEngine = new TorrentEngine()
export { buildMagnetURI, getFileType, infoHashFromMagnet, isUnderRoot, parseMetalink, srtToVtt, stableKey, torrentInfoHash, trackerList }
