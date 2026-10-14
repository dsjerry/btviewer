import { net } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { isBinaryUsable } from './ytdlp-engine'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as NodeWebReadableStream } from 'stream/web'

// yt-dlp 自动安装与自更新：从官方 GitHub Release 下载（net.fetch 走系统代理），
// 并用官方 SHA2-256SUMS 校验完整性；非 Windows 平台提示改用 pip 安装。
// ffmpeg 自动安装：gyan.dev（FFmpeg 官方推荐的 Windows 构建源）essentials 包，
// 用 Windows 自带 tar.exe（libarchive，支持 zip）解压后提取 ffmpeg/ffprobe。
// deno 自动安装：yt-dlp 解 YouTube n 签名挑战所需的 JS 运行时，同样走 tar 解压提取 deno.exe。

const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download'
const CHECKSUMS_URL = `${RELEASE_URL}/SHA2-256SUMS`
const FFMPEG_URL = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
// deno：yt-dlp 解 YouTube n 签名挑战所需的 JS 运行时（官方 Release 单文件 zip）
const DENO_URL = 'https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'
// GNU tar 不支持 zip，必须用系统自带的 tar.exe（Win10 1803+，libarchive 实现）
const WIN_TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

// 各平台的自包含可执行文件名；空串表示该平台无官方单文件版
export function ytdlpAssetName(platform = process.platform): string {
  if (platform === 'win32') return 'yt-dlp.exe'
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

// 下载 yt-dlp 到 targetDir（幂等：已存在直接返回）；onProgress 上报已接收/总字节数
export async function downloadYtDlp(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  const asset = ytdlpAssetName()
  if (!asset) throw new Error('自动安装仅支持 Windows；Linux/macOS 请使用 pip install yt-dlp')
  const target = join(targetDir, asset)
  if (existsSync(target)) return target
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
  // 与官方 SHA2-256SUMS 比对，防止下载源被污染；校验清单拉取失败不阻断安装（HTTPS 已保证传输完整性）
  try {
    const checksums = await net.fetch(CHECKSUMS_URL, { redirect: 'follow' })
    if (checksums.ok) {
      const expected = findChecksum(await checksums.text(), asset)
      const actual = createHash('sha256').update(buffer).digest('hex')
      if (expected && actual !== expected) throw new Error('下载文件校验失败，已放弃安装')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('校验失败')) throw error
  }
  writeFileSync(target, buffer)
  return target
}

// 调用 yt-dlp -U 自更新（仅 exe 版支持；pip 安装版会提示改用 pip 升级），返回结果文案
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

// 下载并安装 ffmpeg（Windows）：约 80MB，zip 流式写盘 → tar 解压 → 提取 ffmpeg/ffprobe 到 targetDir
export async function downloadFfmpeg(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  if (process.platform !== 'win32') throw new Error('自动安装仅支持 Windows；其他平台请通过包管理器安装 ffmpeg')
  const target = join(targetDir, 'ffmpeg.exe')
  if (existsSync(target) && await isBinaryUsable(target, 'ffmpeg')) return target
  mkdirSync(targetDir, { recursive: true })
  const response = await net.fetch(FFMPEG_URL, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || 0)
  const suffix = randomBytes(4).toString('hex')
  const zipPath = join(tmpdir(), `btviewer-ffmpeg-${suffix}.zip`)
  const extractDir = join(tmpdir(), `btviewer-ffmpeg-${suffix}`)
  mkdirSync(extractDir, { recursive: true })
  try {
    await downloadToDisk(response.body as unknown as NodeWebReadableStream, zipPath, total, onProgress)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(WIN_TAR, ['-xf', zipPath, '-C', extractDir], { windowsHide: true })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`解压失败（退出码 ${code}）`)))
    })
    // 解压目录名带版本号（ffmpeg-7.x-essentials_build/bin），递归定位可执行文件
    const ffmpegPath = findExecutable(extractDir, 'ffmpeg.exe')
    if (!ffmpegPath) throw new Error('解压内容中未找到 ffmpeg.exe')
    copyFileSync(ffmpegPath, target)
    const ffprobePath = findExecutable(extractDir, 'ffprobe.exe')
    if (ffprobePath) copyFileSync(ffprobePath, join(targetDir, 'ffprobe.exe'))
    return target
  } finally {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

// 下载并安装 deno（Windows）：约 40MB，zip 流式写盘 → tar 解压 → 提取 deno.exe 到 targetDir
export async function downloadDeno(targetDir: string, onProgress?: (received: number, total: number) => void): Promise<string> {
  if (process.platform !== 'win32') throw new Error('自动安装仅支持 Windows；其他平台请通过包管理器安装 deno')
  const target = join(targetDir, 'deno.exe')
  if (existsSync(target)) return target
  mkdirSync(targetDir, { recursive: true })
  const response = await net.fetch(DENO_URL, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || 0)
  const suffix = randomBytes(4).toString('hex')
  const zipPath = join(tmpdir(), `btviewer-deno-${suffix}.zip`)
  const extractDir = join(tmpdir(), `btviewer-deno-${suffix}`)
  mkdirSync(extractDir, { recursive: true })
  try {
    await downloadToDisk(response.body as unknown as NodeWebReadableStream, zipPath, total, onProgress)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(WIN_TAR, ['-xf', zipPath, '-C', extractDir], { windowsHide: true })
      child.on('error', reject)
      child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`解压失败（退出码 ${code}）`)))
    })
    const denoPath = findExecutable(extractDir, 'deno.exe')
    if (!denoPath) throw new Error('解压内容中未找到 deno.exe')
    copyFileSync(denoPath, target)
    return target
  } finally {
    rmSync(zipPath, { force: true })
    rmSync(extractDir, { recursive: true, force: true })
  }
}

// 递归查找解压目录中的可执行文件
function findExecutable(dir: string, name: string): string | null {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { const found = findExecutable(full, name); if (found) return found }
    else if (entry.name.toLowerCase() === name) return full
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
