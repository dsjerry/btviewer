import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createReadStream, existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { app } from 'electron'
import { join, basename, dirname, isAbsolute, relative, resolve } from 'path'
import { createHash, randomBytes } from 'crypto'
import { logger } from './logger'
import type { TorrentFileInfo, TorrentStatus } from '../src/types'

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
type AriaStatus = { gid: string; status: string; totalLength: string; completedLength: string; downloadSpeed: string; uploadSpeed: string; connections: string; dir: string; errorMessage?: string; bittorrent?: { infoHash?: string; info?: { name?: string } }; info?: string; followedBy?: string[]; belongsTo?: string; files?: AriaFile[] }

function getFileType(filename: string): TorrentFileInfo['type'] { const ext = filename.toLowerCase().slice(filename.lastIndexOf('.')); if (VIDEO_EXTENSIONS.includes(ext)) return 'video'; if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'; if (SUBTITLE_EXTENSIONS.includes(ext)) return 'subtitle'; return 'other' }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function isUnderRoot(root: string, path: string) { const rel = relative(resolve(root), resolve(path)); return !!rel && !rel.startsWith('..') && !isAbsolute(rel) }
function toNumber(value: string | undefined) { return Number(value || 0) || 0 }
function infoHashFromMagnet(value: string) { return value.match(/[?&]xt=urn:btih:([a-z\d]{32,40})/i)?.[1]?.toLowerCase() || '' }
// SRT 转 WebVTT：补 WEBVTT 头并把时间戳的毫秒分隔逗号改为点；本身已是 VTT 的内容原样返回
function srtToVtt(content: string) {
  const text = content.replace(/^\uFEFF/, '')
  if (/^\s*WEBVTT/.test(text)) return text
  return `WEBVTT\n\n${text.replace(/(\d{1,2}:\d{2}:\d{2})\s*,\s*(\d{1,3})/g, '$1.$2').trim()}\n`
}
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
  private downloadDirOverride = ''
  private trackerOverride = ''
  private maxConcurrent = 0
  private speedLimit = ''
  // 任务持久化：hash -> 任务来源（磁力链接 / .torrent 路径），done 表示已完整下载过
  private taskSources = new Map<string, { source: string; done: boolean }>()
  private tasksFile = () => join(app.getPath('userData'), 'tasks.json')

  // 设置页写入的持久化配置：未启动时仅记录（spawn 时生效），已启动则热应用到 aria2
  configure(options: { downloadDir?: string; trackers?: string; maxConcurrentDownloads?: number; speedLimit?: string }) {
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
  }

  effectiveDownloadDir() { return this.downloadDirOverride || this.dataDir || join(app.getPath('userData'), 'aria2-downloads') }

  private persistTasks() {
    try { writeFileSync(this.tasksFile(), JSON.stringify({ tasks: [...this.taskSources].map(([hash, task]) => ({ hash, ...task })) }, null, 2)) } catch (error) { logger.error('tasks', `persist failed: ${getErrorMessage(error)}`) }
  }

  private restoreTasks() {
    try {
      const raw = JSON.parse(readFileSync(this.tasksFile(), 'utf8')) as { tasks?: Array<{ hash: string; source: string; done?: boolean }> }
      for (const task of raw.tasks || []) {
        if (!task.source || this.taskSources.has(task.hash)) continue
        this.taskSources.set(task.hash, { source: task.source, done: !!task.done })
        logger.info('tasks', `restoring ${task.hash}${task.done ? ' (complete)' : ''}`)
        void this.addTorrent(task.source, undefined, { wait: false }).catch((error) => {
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
      if (error instanceof Error && error.name === 'TimeoutError') throw new Error('aria2 RPC 请求超时')
      throw error
    }
    const body = await response.json() as RpcResponse<T>
    if (body.error) throw new Error(body.error.message)
    if (body.result === undefined) throw new Error('aria2 返回了空响应')
    return body.result
  }

  async addTorrent(torrentId: string, onStatus?: (status: TorrentStatus) => void, opts: { wait?: boolean } = {}) {
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
    const options = { 'seed-time': '0', 'bt-tracker': trackerList(this.trackerOverride), ...(isTorrentFile ? { pause: 'true' } : { 'pause-metadata': 'true', 'bt-save-metadata': 'true' }) }
    const gid = await this.rpc<string>('addUri', [[id], options])
    if (!isTorrentFile) this.metadataGids.add(gid)
    const first = await this.refreshGid(gid, hash || gid, onStatus)
    const key = first.bittorrent?.infoHash?.toLowerCase() || hash || gid
    if (key !== gid) {
      this.gidHashes.set(gid, key)
      if (onStatus) this.callbacks.set(key, onStatus)
    }
    this.taskSources.set(key, { source: id, done: false })
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
  async pauseTorrent(infoHash: string) { const status = await this.findStatus(infoHash); await this.rpc('pause', [status.gid]); await this.refreshGid(status.gid, infoHash) }
  async resumeTorrent(infoHash: string) { const status = await this.findStatus(infoHash); await this.rpc('unpause', [status.gid]); await this.refreshGid(status.gid, infoHash) }
  async removeTorrent(infoHash: string, destroy = false) {
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
      const active = await this.rpc<AriaStatus[]>('tellActive', []).catch(() => [])
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
    const listener = this.callbacks.get(hash) || this.callbacks.get(hash.toLowerCase())
    if (listener) listener(this.toTorrentStatus(hash, status))
  }
  private async refreshGid(gid: string, hash: string, callback?: (status: TorrentStatus) => void): Promise<AriaStatus> { const status = await this.rpc<AriaStatus>('tellStatus', [gid, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'dir', 'bittorrent', 'followedBy', 'belongsTo', 'files']]); this.gidHashes.set(gid, hash); if (callback) this.callbacks.set(hash, callback); this.applyStatus(hash, status); return status }
  private async findStatus(infoHash: string) { const hash = infoHash.toLowerCase(); const existing = this.statuses.get(hash); if (existing) return existing; await this.refreshStatuses(); const found = this.statuses.get(hash); if (!found) throw new Error('下载任务不存在'); return found }
  private toTorrentStatus(hash: string, status: AriaStatus): TorrentStatus {
    const totalSize = toNumber(status.totalLength) || (status.files || []).reduce((sum, file) => sum + toNumber(file.length), 0)
    const downloaded = toNumber(status.completedLength)
    const downloadSpeed = toNumber(status.downloadSpeed)
    const files = (status.files || []).map((file) => ({ name: relative(status.dir || this.dataDir, file.path) || basename(file.path), path: file.path, size: toNumber(file.length), type: getFileType(file.path) }))
    const name = status.bittorrent?.info?.name || status.info || hash
    const state: TorrentStatus['status'] = status.status === 'error' ? 'error' : this.metadataGids.has(status.gid) ? 'parsing' : status.status === 'paused' ? 'paused' : status.status === 'complete' ? 'seeding' : status.status === 'active' ? 'downloading' : 'connecting'
    return { infoHash: hash, name, magnetURI: buildMagnetURI(hash, name, trackerList(this.trackerOverride).split(',')), progress: totalSize ? downloaded / totalSize : 0, downloadSpeed, uploadSpeed: toNumber(status.uploadSpeed), downloaded, totalSize, numPeers: toNumber(status.connections), timeRemaining: downloadSpeed > 0 ? Math.ceil(((totalSize - downloaded) / downloadSpeed) * 1000) : 0, status: state, error: state === 'error' ? status.errorMessage || '任务出错' : undefined, files }
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
export { buildMagnetURI, getFileType, infoHashFromMagnet, isUnderRoot, srtToVtt, torrentInfoHash, trackerList }
