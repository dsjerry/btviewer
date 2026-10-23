import { app, net } from 'electron'
import { spawn } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'stream/web'
import { clearDetectCache, isBinaryUsable } from './ytdlp-engine'
import { denyAssetMessage, ensureExecutable } from './installer-support'

// 外挂依赖的自动安装：用户不该被要求打开终端敲 pip/brew。
// 三平台都从官方 Release 拉「自包含单文件」构建，装进 userData/bin（用户目录可写，升级应用不需要提权），
// 装完由 detectBinary 优先命中该目录，和系统 PATH 里的版本互不干扰。
//
// yt-dlp：官方 Release 独立可执行文件（.exe / _macos / _linux[_aarch64]），配官方 SHA2-256SUMS 校验
// deno  ：官方 Release 单文件 zip（解 YouTube n 签名挑战所需），Windows 用系统 tar.exe 解压，macOS 用 ditto，Linux 用 unzip
// ffmpeg：Windows 用 gyan.dev essentials；macOS 优先复制安装包内置的 ffmpeg/ffprobe（官方 BtbN 构建），
//         缺失时回退 evermeet.cx（仅 Intel 构建，Apple 芯片上不可用，需替换为可执行文件）；Linux 不做应用内安装

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const CHECKSUMS_URL = `${RELEASE_URL}/SHA2-256SUMS`
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
// evermeet.cx 会按 UA 把真实文件重定向到 CDN，不带浏览器 UA 时 CDN 返回 403
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const EVERMEET_INFO = 'https://evermeet.cx/ffmpeg/info'
// GNU tar 不支持 zip，必须用系统自带的 tar.exe（Win10 1803+，libarchive 实现）
const WIN_TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

function isWin(platform = process.platform) { return platform === 'win32' }
function exeSuffix(platform = process.platform) { return isWin(platform) ? '.exe' : '' }

// 应用内可写安装目录：自动安装的产物统一放这里
export function installDir(): string {
  return join(app.getPath('userData'), 'bin')
}

function resourceDir(name: string): string {
  const root = app.isPackaged ? process.resourcesPath : devResourceRoot()
  return join(root, name)
}

// electron-vite 只把 resources/ 拷到 <outDir>/resources（开发时相对于 main.js），
// 所以开发态优先用 app.getAppPath()/resources，其次退回 main.js 同级的 resources。
function devResourceRoot(): string {
  const candidates = [join(app.getAppPath(), 'resources'), join(__dirname, 'resources')]
  return candidates.find((dir) => existsSync(dir)) || candidates[0]
}

export function platformTag(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win' : platform === 'darwin' ? 'mac' : 'linux'
  return `${os}-${arch === 'arm64' ? 'arm64' : 'x64'}`
}

// ── yt-dlp ─────────────────────────────────────────────────────────

// 各平台官方 Release 的自包含可执行文件名；空串表示该平台没有可用资产
export function ytdlpAssetName(platform = process.platform, arch = process.arch): string {
  if (isWin(platform)) return arch === 'arm64' ? 'yt-dlp_arm64.exe' : arch === 'ia32' ? 'yt-dlp_x86.exe' : 'yt-dlp.exe'
  if (platform === 'darwin') return 'yt-dlp_macos'
  if (platform === 'linux') return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux'
  return ''
}

// 解析 SHA2-256SUMS 中目标文件的哈希（行格式：<sha256>  <filename>，* 前缀表示二进制模式）
export function findChecksum(text: string, asset: string): string | null {
  for (const line of text.split('\n')) {
    const match = /^([a-f\d]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (match && match[2].trim() === asset) return match[1].toLowerCase()
  }
  return null
}

// 下载 yt-dlp 到 targetDir（幂等：已存在且能执行就直接返回）；onProgress 上报已接收/总字节数
export async function downloadYtDlp(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  const asset = ytdlpAssetName()
  if (!asset) throw new Error(denyAssetMessage('yt-dlp', { platform: process.platform, arch: process.arch }))
  const target = join(targetDir, `yt-dlp${exeSuffix()}`)
  if (existsSync(target) && await isBinaryUsable(target, 'yt-dlp')) return target
  mkdirSync(targetDir, { recursive: true })
  const response = await net.fetch(`${RELEASE_URL}/${asset}`, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || 0)
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of response.body as unknown as Iterable<ArrayBuffer>) {
    chunks.push(Buffer.from(chunk))
    received += chunk.byteLength
    onProgress?.(received, total)
  }
  const buffer = Buffer.concat(chunks)
  // 规则：官方给出了校验值就必须一致；拉不到校验清单（网络/代理受限）不阻断安装，HTTPS 已保证传输完整性
  let expected: string | null = null
  try {
    const checksums = await net.fetch(CHECKSUMS_URL, { redirect: 'follow' })
    if (checksums.ok) expected = findChecksum(await checksums.text(), asset)
  } catch { /* 校验清单不可达时跳过比对 */ }
  if (expected && createHash('sha256').update(buffer).digest('hex') !== expected) throw new Error('下载文件校验失败，已放弃安装')
  writeFileSync(target, buffer)
  makeExecutable(target)
  return target
}

// 调用 yt-dlp -U 自更新（仅官方单文件版支持；pip 安装版会提示改用 pip 升级），返回结果文案
export function updateYtDlp(binaryPath: string, timeoutMs = 120000): Promise<string> {
  return new Promise((resolve) => {
    let settled = false
    const done = (text: string) => { if (!settled) { settled = true; resolve(text) } }
    try {
      const child = spawn(binaryPath, ['-U'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
      const timer = setTimeout(() => { child.kill(); done('更新超时，请稍后重试') }, timeoutMs)
      child.on('error', (error) => { clearTimeout(timer); done(`更新失败：${error.message}`) })
      child.on('exit', (code) => {
        clearTimeout(timer)
        const lastLine = output.trim().split('\n').filter(Boolean).pop() || ''
        done(code === 0 ? (lastLine || '已是最新版本') : `更新失败（退出码 ${code}）：${lastLine}`)
      })
    } catch (error) { done(`更新失败：${error instanceof Error ? error.message : String(error)}`) }
  })
}

// ── ffmpeg ─────────────────────────────────────────────────────────

// ffmpeg 安装策略（纯函数，便于单测）：
//   windows → gyan.dev 自动下载
//   macOS   → 优先安装包内置的 ffmpeg/ffprobe，没有则 evermeet.cx 下载
//   linux   → 不做应用内安装（发行版 ffmpeg 才是正确来源）
export type FfmpegStrategy = 'download-windows' | 'bundled-macos' | 'download-macos' | 'unsupported-linux'
export function ffmpegStrategy(platform = process.platform, bundledAvailable = false): FfmpegStrategy {
  if (isWin(platform)) return 'download-windows'
  if (platform === 'darwin') return bundledAvailable ? 'bundled-macos' : 'download-macos'
  return 'unsupported-linux'
}

// 内置媒体资源目录（按平台-架构）
export function bundledMediaDir(platform = process.platform, arch = process.arch): string {
  return resourceDir(join('media', platformTag(platform, arch)))
}

// 安装 ffmpeg 到 targetDir；macOS 优先复制安装包内置版本
export async function downloadFfmpeg(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  const target = join(targetDir, `ffmpeg${exeSuffix()}`)
  if (existsSync(target) && await isBinaryUsable(target, 'ffmpeg')) return target
  mkdirSync(targetDir, { recursive: true })
  const bundled = bundledMediaDir()
  const strategy = ffmpegStrategy(process.platform, existsSync(join(bundled, `ffmpeg${exeSuffix()}`)))
  if (strategy === 'bundled-macos') {
    onProgress?.(1, 1)
    copyAndMakeExecutable(join(bundled, 'ffmpeg'), target)
    const probe = join(bundled, 'ffprobe')
    if (existsSync(probe)) copyAndMakeExecutable(probe, join(targetDir, 'ffprobe'))
    return target
  }
  if (strategy === 'unsupported-linux') {
    throw new Error('Linux 上 ffmpeg 由发行版包管理器维护（各发行版构建的编解码器不同），请在「软件中心」安装 ffmpeg')
  }
  if (strategy === 'download-macos') {
    // evermeet 只提供 Intel（x86_64）构建，Apple 芯片上跑不了：直接说清楚原因和可行的下一步，
    // 不要下载 26MB 再报「架构不匹配」——那是把我们的打包问题甩给用户。
    if (process.arch === 'arm64') {
      throw new Error('当前安装包未包含 Apple 芯片版 ffmpeg，且没有可用的官方下载源。请更新到最新安装包（已内置 ffmpeg），或把 ffmpeg 放到「设置 → 视频站点解析 → yt-dlp 路径」可用的位置')
    }
    await downloadFfmpegMac(targetDir, target, onProgress)
    // Intel 机器上也要验证：下载源被中间页劫持（UA 判定失败）时会拿到残缺文件
    if (!await isBinaryUsable(target, 'ffmpeg')) {
      rmSync(target, { force: true })
      throw new Error('下载的 ffmpeg 无法运行（文件不完整或网络被拦截），请稍后重试')
    }
    return target
  }
  await downloadFfmpegWindows(targetDir, target, onProgress)
  return target
}

async function downloadFfmpegWindows(targetDir: string, target: string, onProgress?: (received: number, total: number) => void) {
  const response = await net.fetch(FFMPEG_URL, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || 0)
  const suffix = randomBytes(4).toString('hex')
  const zipPath = join(tmpdir(), `btviewer-ffmpeg-${suffix}.zip`)
  const extractDir = join(tmpdir(), `btviewer-ffmpeg-${suffix}`)
  mkdirSync(extractDir, { recursive: true })
  try {
    await downloadToDisk(response.body as unknown as NodeWebReadableStream, zipPath, total, onProgress)
    await extractArchive(zipPath, extractDir)
    // 解压目录名带版本号（ffmpeg-7.x-essentials_build/bin），递归定位可执行文件
    const ffmpegPath = findExecutable(extractDir, 'ffmpeg.exe')
    if (!ffmpegPath) throw new Error('解压内容中未找到 ffmpeg.exe')
    copyFileSync(ffmpegPath, target)
    const ffprobePath = findExecutable(extractDir, 'ffprobe.exe')
    if (ffprobePath) copyFileSync(ffprobePath, join(targetDir, 'ffprobe.exe'))
  } finally {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

// evermeet.cx 的构建是 Intel（x86_64）单文件 zip，版本号从 info JSON 取；Apple 芯片上由调用方做可执行校验后拒绝
async function downloadFfmpegMac(targetDir: string, target: string, onProgress?: (received: number, total: number) => void) {
  for (const name of ['ffmpeg', 'ffprobe'] as const) {
    const infoResponse = await net.fetch(`${EVERMEET_INFO}/${name}/release`, { headers: { 'user-agent': BROWSER_UA } })
    if (!infoResponse.ok) throw new Error(`获取 ${name} 版本信息失败（HTTP ${infoResponse.status}），请检查网络或代理`)
    const info = JSON.parse(await infoResponse.text()) as { download?: { zip?: { url?: string } } }
    const url = info.download?.zip?.url
    if (!url) throw new Error(`未找到 ${name} 的 macOS 下载地址`)
    const zip = await net.fetch(url, { headers: { 'user-agent': BROWSER_UA }, redirect: 'follow' })
    if (!zip.ok) throw new Error(`下载 ${name} 失败（HTTP ${zip.status}），请检查网络或代理`)
    const total = Number(zip.headers.get('content-length') || 0)
    const suffix = randomBytes(4).toString('hex')
    const zipPath = join(tmpdir(), `btviewer-${name}-${suffix}.zip`)
    const extractDir = join(tmpdir(), `btviewer-${name}-${suffix}`)
    mkdirSync(extractDir, { recursive: true })
    try {
      await downloadToDisk(zip.body as unknown as NodeWebReadableStream, zipPath, total, name === 'ffmpeg' ? onProgress : undefined)
      await extractArchive(zipPath, extractDir)
      const found = findExecutable(extractDir, name)
      if (!found) throw new Error(`解压内容中未找到 ${name}`)
      // zip 解压后可能丢可执行位，统一走复制并补权限
      copyAndMakeExecutable(found, join(targetDir, name))
    } finally {
      rmSync(zipPath, { force: true })
      rmSync(extractDir, { recursive: true, force: true })
    }
  }
}

// ── deno ───────────────────────────────────────────────────────────

const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download'

// deno 官方 zip 资产名（三平台 × x64/arm64）
export function denoAssetName(platform = process.platform, arch = process.arch): string {
  const a = arch === 'arm64' ? 'aarch64' : 'x86_64'
  if (isWin(platform)) return `deno-${a}-pc-windows-msvc.zip`
  if (platform === 'darwin') return `deno-${a}-apple-darwin.zip`
  return `deno-${a}-unknown-linux-gnu.zip`
}

// 下载并安装 deno（约 40MB）：zip 流式写盘 → 解压 → 提取 deno 可执行文件
export async function downloadDeno(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  const asset = denoAssetName()
  const target = join(targetDir, `deno${exeSuffix()}`)
  if (existsSync(target)) return target
  mkdirSync(targetDir, { recursive: true })
  const response = await net.fetch(`${DENO_URL}/${asset}`, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || 0)
  const suffix = randomBytes(4).toString('hex')
  const zipPath = join(tmpdir(), `btviewer-deno-${suffix}.zip`)
  const extractDir = join(tmpdir(), `btviewer-deno-${suffix}`)
  mkdirSync(extractDir, { recursive: true })
  try {
    await downloadToDisk(response.body as unknown as NodeWebReadableStream, zipPath, total, onProgress)
    await extractArchive(zipPath, extractDir)
    const denoPath = findExecutable(extractDir, `deno${exeSuffix()}`)
    if (!denoPath) throw new Error(`解压内容中未找到 deno${exeSuffix()}`)
    copyAndMakeExecutable(denoPath, target)
    return target
  } finally {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

// ── 通用工具 ───────────────────────────────────────────────────────

// 解压 zip 的命令：Windows 用系统 tar.exe（libarchive）；macOS 用 ditto（保留权限与资源分叉）；
// Linux 用 unzip。三者都是系统自带，不需要打包第三方解压库。
export function extractCommand(archive: string, dest: string, platform = process.platform): { command: string; args: string[] } {
  if (isWin(platform)) return { command: WIN_TAR, args: ['-xf', archive, '-C', dest] }
  if (platform === 'darwin') return { command: '/usr/bin/ditto', args: ['-x', '-k', archive, dest] }
  return { command: 'unzip', args: ['-oq', archive, '-d', dest] }
}

function extractArchive(archive: string, dest: string): Promise<void> {
  const { command, args } = extractCommand(archive, dest)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', (error) => reject(new Error(`解压失败：${error.message}`)))
    child.on('exit', (code) => {
      if (code === 0) { resolve(); return }
      const detail = stderr.trim().split('\n').pop()
      reject(new Error(`解压失败（退出码 ${code}）${detail ? `：${detail}` : ''}`))
    })
  })
}

// 可执行位统一交给 installer-support（纯逻辑，有单测）
function makeExecutable(path: string) {
  ensureExecutable(path, { chmod: chmodSync })
}

function copyAndMakeExecutable(from: string, to: string) {
  copyFileSync(from, to)
  makeExecutable(to)
}

// 递归查找解压目录中的可执行文件（大小写不敏感，兼容 Windows 命名）
function findExecutable(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { const found = findExecutable(full, name); if (found) return found }
    else if (entry.name.toLowerCase() === name.toLowerCase()) return full
  }
  return null
}

// web 流 → 磁盘文件，逐块上报进度
async function downloadToDisk(body: NodeWebReadableStream, filePath: string, total: number, onProgress?: (received: number, total: number) => void) {
  let received = 0
  const source = Readable.fromWeb(body)
  source.on('data', (chunk: Buffer) => { received += chunk.length; onProgress?.(received, total) })
  await pipeline(source, createWriteStream(filePath))
}

// 启动时把安装包内置的媒体工具落到 userData/bin（仅在缺失时复制，不覆盖用户自己更新过的版本）。
// 返回复制成功的文件名，供日志/诊断使用。
export function seedBundledMedia(targetDir = installDir()): string[] {
  const source = bundledMediaDir()
  const copied: string[] = []
  try {
    if (!existsSync(source)) return copied
    mkdirSync(targetDir, { recursive: true })
    for (const name of readdirSync(source)) {
      const from = join(source, name)
      const to = join(targetDir, name)
      if (existsSync(to) || !statSync(from).isFile()) continue
      copyAndMakeExecutable(from, to)
      copied.push(name)
    }
  } catch { /* 内置资源缺失或复制失败不应阻断启动：检测阶段仍会回退系统 PATH */ }
  if (copied.length) clearDetectCache()
  return copied
}

// 各平台能否一键安装：设置页据此决定显示「安装」按钮还是面向普通用户的说明
export function installCapabilities(platform = process.platform, arch = process.arch) {
  return {
    ytdlp: ytdlpAssetName(platform, arch) !== '',
    ffmpeg: platform !== 'linux',
    deno: true
  }
}
