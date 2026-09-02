import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createReadStream, existsSync, mkdirSync, statSync } from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { app } from 'electron'
import { join, basename, dirname, relative, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { TorrentFileInfo, TorrentStatus } from '../src/types'

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.wmv', '.m4v', '.ts', '.rmvb']
const AUDIO_EXTENSIONS = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma']
const SUBTITLE_EXTENSIONS = ['.srt', '.ass', '.ssa', '.vtt', '.sub']
const RPC_VERSION = 'aria2'

type RpcResponse<T> = { result?: T; error?: { code: number; message: string } }
type AriaFile = { index: string; path: string; length: string; completedLength: string; selected: string }
type AriaStatus = { gid: string; status: string; totalLength: string; completedLength: string; downloadSpeed: string; uploadSpeed: string; connections: string; dir: string; bittorrent?: { infoHash?: string }; info?: string; files?: AriaFile[] }

function getFileType(filename: string): TorrentFileInfo['type'] { const ext = filename.toLowerCase().slice(filename.lastIndexOf('.')); if (VIDEO_EXTENSIONS.includes(ext)) return 'video'; if (AUDIO_EXTENSIONS.includes(ext)) return 'audio'; if (SUBTITLE_EXTENSIONS.includes(ext)) return 'subtitle'; return 'other' }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : String(error) }
function toNumber(value: string | undefined) { return Number(value || 0) || 0 }
function infoHashFromMagnet(value: string) { return value.match(/[?&]xt=urn:btih:([a-z\d]{32,40})/i)?.[1]?.toLowerCase() || '' }
function executablePath() {
  const name = process.platform === 'win32' ? 'aria2c.exe' : 'aria2c'
  const bundled = app.isPackaged ? join(process.resourcesPath, 'aria2', name) : join(app.getAppPath(), 'resources', 'aria2', name)
  return process.env.ARIA2C_PATH || (existsSync(bundled) ? bundled : 'aria2c')
}

class TorrentEngine {
  private process: ChildProcessWithoutNullStreams | null = null
  private rpcUrl = ''
  private secret = randomBytes(16).toString('hex')
  private server: Server | null = null
  private serverPort = 0
  private statuses = new Map<string, AriaStatus>()
  private callbacks = new Map<string, (status: TorrentStatus) => void>()
  private timer: NodeJS.Timeout | null = null
  private dataDir = ''
  private startPromise: Promise<number> | null = null

  async startServer() {
    if (this.serverPort) return this.serverPort
    if (this.startPromise) return this.startPromise
    this.startPromise = this.start()
    try { return await this.startPromise } finally { this.startPromise = null }
  }

  private async start(): Promise<number> {
    this.dataDir = join(app.getPath('userData'), 'aria2-downloads')
    mkdirSync(this.dataDir, { recursive: true })
    const rpcPort = 20000 + Math.floor(Math.random() * 20000)
    const binary = executablePath()
    const env = { ...process.env }
    delete env.all_proxy
    delete env.ALL_PROXY
    if (process.platform === 'linux' && binary !== 'aria2c') env.LD_LIBRARY_PATH = `${dirname(binary)}${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`
    const child = spawn(binary, [`--enable-rpc=true`, `--rpc-listen-all=false`, `--rpc-listen-port=${rpcPort}`, `--rpc-secret=${this.secret}`, `--dir=${this.dataDir}`, '--continue=true', '--bt-enable-lpd=true', '--enable-dht=true', '--enable-peer-exchange=true', '--bt-enable-hook-after-hash-check=true', '--seed-time=0', '--file-allocation=none'], { windowsHide: true, env })
    this.process = child
    let startupError = ''
    let spawnErrorCode: string | undefined
    child.stderr.on('data', (chunk) => { startupError += chunk.toString(); console.error('[aria2]', chunk.toString().trim()) })
    child.on('error', (error: NodeJS.ErrnoException) => { spawnErrorCode = error.code; console.error('[aria2] process error:', getErrorMessage(error)) })
    this.rpcUrl = `http://127.0.0.1:${rpcPort}/jsonrpc`
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) { try { await this.rpc('aria2.getVersion', []); break } catch { await new Promise((resolve) => setTimeout(resolve, 150)) } }
    try { await this.rpc('aria2.getVersion', []) } catch { throw new Error(spawnErrorCode === 'ENOENT' ? '未找到 aria2c，请安装 aria2 或配置 ARIA2C_PATH' : `aria2 启动失败：${startupError || 'RPC 服务未响应'}`) }
    this.server = createServer((request, response) => this.handleStream(request, response))
    await new Promise<void>((resolve, reject) => { this.server?.once('error', reject); this.server?.listen(0, '127.0.0.1', () => resolve()) })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('无法启动本地媒体流服务')
    this.serverPort = address.port
    this.timer = setInterval(() => void this.refreshStatuses(), 1000)
    void this.refreshStatuses()
    return this.serverPort
  }

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(this.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: method.startsWith(`${RPC_VERSION}.`) ? method : `${RPC_VERSION}.${method}`, params: [`token:${this.secret}`, ...params] }) })
    const body = await response.json() as RpcResponse<T>
    if (body.error) throw new Error(body.error.message)
    if (body.result === undefined) throw new Error('aria2 返回了空响应')
    return body.result
  }

  async addTorrent(torrentId: string, onStatus?: (status: TorrentStatus) => void): Promise<TorrentStatus> {
    await this.startServer()
    const id = torrentId.trim()
    if (!id.startsWith('magnet:?') && !id.toLowerCase().endsWith('.torrent')) throw new Error('请输入有效的磁力链接或 torrent 文件路径')
    const options = { 'pause-metadata': 'true', 'seed-time': '0', 'bt-save-metadata': 'true' }
    const gid = await this.rpc<string>('addUri', [[id], options])
    const hash = infoHashFromMagnet(id)
    if (onStatus && hash) this.callbacks.set(hash, onStatus)
    await this.refreshGid(gid, hash, onStatus)
    return this.getStatus(hash || gid)
  }

  async downloadTorrent(infoHash: string) { const status = await this.findStatus(infoHash); const files = status.files || []; if (!files.length) throw new Error('种子文件信息尚未准备完成'); await this.rpc('changeOption', [status.gid, { 'select-file': files.map((file) => file.index).join(','), pause: 'false' }]); await this.refreshGid(status.gid, infoHash) }
  async pauseTorrent(infoHash: string) { const status = await this.findStatus(infoHash); await this.rpc('pause', [[status.gid]]); await this.refreshGid(status.gid, infoHash) }
  async resumeTorrent(infoHash: string) { const status = await this.findStatus(infoHash); await this.rpc('unpause', [[status.gid]]); await this.refreshGid(status.gid, infoHash) }
  async removeTorrent(infoHash: string, _destroy = false) { const status = await this.findStatus(infoHash); await this.rpc('removeDownloadResult', [[status.gid]]); this.statuses.delete(infoHash); this.callbacks.delete(infoHash) }
  getAllStatuses() { return [...this.statuses.entries()].map(([hash, status]) => this.toTorrentStatus(hash, status)) }
  getStreamUrl(infoHash: string, filePath: string) { const hash = infoHash.toLowerCase(); const status = this.statuses.get(hash); const fileIndex = status?.files?.find((file) => file.path === filePath || basename(file.path) === filePath)?.index; if (!status || !fileIndex) throw new Error('媒体文件尚未准备完成'); return `http://127.0.0.1:${this.serverPort}/stream/${encodeURIComponent(hash)}/${fileIndex}` }

  private async refreshStatuses() { const active = await this.rpc<AriaStatus[]>('tellActive', []).catch(() => []); const waiting = await this.rpc<AriaStatus[]>('tellWaiting', [0, 1000]).catch(() => []); const stopped = await this.rpc<AriaStatus[]>('tellStopped', [0, 1000]).catch(() => []); const all = [...active, ...waiting, ...stopped]; for (const status of all) { const hash = status.bittorrent?.infoHash?.toLowerCase() || [...this.statuses.entries()].find(([, item]) => item.gid === status.gid)?.[0] || status.gid; await this.refreshGid(status.gid, hash) } }
  private async refreshGid(gid: string, hash: string, callback?: (status: TorrentStatus) => void) { const status = await this.rpc<AriaStatus>('tellStatus', [gid, ['gid', 'status', 'totalLength', 'completedLength', 'downloadSpeed', 'uploadSpeed', 'connections', 'dir', 'bittorrent', 'info', 'files']]); this.statuses.set(hash, status); if (callback) this.callbacks.set(hash, callback); const listener = this.callbacks.get(hash); if (listener) listener(this.toTorrentStatus(hash, status)) }
  private async findStatus(infoHash: string) { const hash = infoHash.toLowerCase(); const existing = this.statuses.get(hash); if (existing) return existing; await this.refreshStatuses(); const found = this.statuses.get(hash); if (!found) throw new Error('下载任务不存在'); return found }
  private getStatus(key: string) { const status = this.statuses.get(key.toLowerCase()) || this.statuses.get(key); if (!status) throw new Error('下载任务正在解析，请稍候'); return this.toTorrentStatus(key, status) }
  private toTorrentStatus(hash: string, status: AriaStatus): TorrentStatus { const files = (status.files || []).map((file) => ({ name: relative(status.dir || this.dataDir, file.path) || basename(file.path), path: file.path, size: toNumber(file.length), type: getFileType(file.path) })); const state: TorrentStatus['status'] = status.status === 'paused' ? 'paused' : status.status === 'complete' ? 'seeding' : status.status === 'error' ? 'error' : status.status === 'active' ? 'downloading' : 'connecting'; return { infoHash: hash, name: status.info || hash, magnetURI: '', progress: toNumber(status.totalLength) ? toNumber(status.completedLength) / toNumber(status.totalLength) : 0, downloadSpeed: toNumber(status.downloadSpeed), uploadSpeed: toNumber(status.uploadSpeed), downloaded: toNumber(status.completedLength), totalSize: toNumber(status.totalLength), numPeers: toNumber(status.connections), timeRemaining: 0, status: state, files } }

  private async handleStream(request: IncomingMessage, response: ServerResponse) { const match = request.url?.match(/^\/stream\/([^/]+)\/(\d+)$/); if (!match) { response.writeHead(404); response.end(); return } const hash = decodeURIComponent(match[1]); const status = this.statuses.get(hash); if (!status) { response.writeHead(404); response.end('Task not found'); return } const file = status.files?.find((item) => item.index === match[2]); if (!file) { response.writeHead(404); response.end('File not found'); return } const root = resolve(status.dir || this.dataDir); const path = resolve(file.path); if (!path.startsWith(`${root}/`) && path !== root) { response.writeHead(403); response.end(); return } try { const fileStat = statSync(path); const range = request.headers.range; const start = range ? Number(range.match(/bytes=(\d+)-/)?.[1] || 0) : 0; const end = range ? Math.min(Number(range.match(/-(\d+)$/)?.[1] || fileStat.size - 1), fileStat.size - 1) : fileStat.size - 1; response.writeHead(range ? 206 : 200, { 'content-type': getMime(path), 'content-length': end - start + 1, 'accept-ranges': 'bytes', ...(range ? { 'content-range': `bytes ${start}-${end}/${fileStat.size}` } : {}) }); createReadStream(path, { start, end }).pipe(response) } catch { response.writeHead(404); response.end('File not ready') } }

  async destroy() { if (this.timer) clearInterval(this.timer); this.timer = null; await new Promise<void>((resolve) => { if (!this.process) return resolve(); this.process.once('exit', () => resolve()); this.process.kill() }); this.server?.close(); this.server = null; this.serverPort = 0; this.statuses.clear(); this.callbacks.clear(); this.process = null }
}
function getMime(filename: string) { const ext = filename.toLowerCase().slice(filename.lastIndexOf('.')); return ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg' } as Record<string, string>)[ext] || 'application/octet-stream' }
export const torrentEngine = new TorrentEngine()
export { getFileType }
