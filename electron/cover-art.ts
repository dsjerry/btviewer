// 内嵌封面提取（B7）：MKV 附件 / MP4 covr / FLAC picture 等封面在 ffprobe 里表现为
// disposition.attached_pic = 1 的视频流，用 ffmpeg 抽一帧出来即可，比截帧更准也更快。
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { detectBinary } from './ytdlp-engine'
import { logger } from './logger'

// 封面超过这个体积就不当作缩略图（缩略图存储单条上限 200KB，base64 还会膨胀 ~33%）
const MAX_COVER_BYTES = 140 * 1024

// 图片编码的「视频流」按封面处理。实测：MP4/M4A 的 covr 用 disposition.attached_pic=1 标记，
// 而 MKV 的附件被 mkv demuxer 报成普通 video 流（mjpeg/png、attached_pic=0），只能靠编码判断。
export const IMAGE_CODECS = ['mjpeg', 'jpeg', 'png', 'bmp', 'gif', 'webp', 'tiff']

export function isImageCodec(codec: string | undefined) {
  return !!codec && IMAGE_CODECS.includes(codec.toLowerCase())
}

export interface ProbeStream {
  index?: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  disposition?: { attached_pic?: number }
}

// 挑出封面流：attached_pic 标记，或图片编码的视频/附件流
export function pickCoverStream(json: string): { index: number; codec: string } | null {
  let streams: ProbeStream[]
  try {
    streams = (JSON.parse(json) as { streams?: ProbeStream[] }).streams || []
  } catch { return null }
  const isCover = (stream: ProbeStream) => {
    if (typeof stream.index !== 'number') return false
    if (stream.disposition?.attached_pic === 1) return true
    if (stream.codec_type === 'attachment') return true
    return stream.codec_type === 'video' && isImageCodec(stream.codec_name)
  }
  const cover = streams.find(isCover)
  return cover && typeof cover.index === 'number' ? { index: cover.index, codec: (cover.codec_name || 'mjpeg').toLowerCase() } : null
}

// 真实视频流编码：忽略封面（否则兼容转码会把封面当成主视频来分析）
export function mainVideoCodec(json: string): string {
  try {
    const streams = (JSON.parse(json) as { streams?: ProbeStream[] }).streams || []
    const video = streams.find((stream) => stream.codec_type === 'video' && !isImageCodec(stream.codec_name) && stream.disposition?.attached_pic !== 1)
    return (video?.codec_name || '').toLowerCase()
  } catch { return '' }
}

function runCapture(binary: string, args: string[], encoding: 'utf8' | 'buffer'): Promise<{ stdout: string | Buffer; stderr: string }> {
  return new Promise((resolve) => {
    execFile(binary, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, encoding: encoding as BufferEncoding }, (error, stdout, stderr) => {
      resolve({ stdout: stdout ?? (encoding === 'buffer' ? Buffer.alloc(0) : ''), stderr: stderr || (error ? String(error.message) : '') })
    })
  })
}

// 应用内一键安装的 ffmpeg 目录；非 Electron 环境（单测）下拿不到就退回 PATH 探测
function bundledBinaryDir(): string | undefined {
  try { return join(app.getPath('userData'), 'bin') } catch { return undefined }
}

async function resolveFfmpeg() {
  // 优先级：FFMPEG_PATH 环境变量 > 应用内安装目录 > PATH（与 aria2 的 ARIA2C_PATH 同款约定）
  const custom = process.env.FFMPEG_PATH
  const ffmpeg = custom && existsSync(custom) ? custom : await detectBinary(undefined, 'ffmpeg', bundledBinaryDir())
  if (!ffmpeg) return null
  const ffprobe = join(dirname(ffmpeg), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  return { ffmpeg, ffprobe: existsSync(ffprobe) ? ffprobe : null }
}

// 返回 data URL；没有内嵌封面、没有 ffmpeg 或封面过大时返回 null（调用方回退到截帧）
export async function extractEmbeddedCover(filePath: string): Promise<string | null> {
  const binaries = await resolveFfmpeg()
  if (!binaries?.ffprobe) return null
  const probe = await runCapture(binaries.ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath], 'utf8')
  const cover = pickCoverStream(String(probe.stdout))
  if (!cover) return null
  // -c:v mjpeg 保证输出是浏览器认得的格式（png 封面也能转出来）
  const frame = await runCapture(binaries.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', `0:${cover.index}`, '-frames:v', '1', '-f', 'image2', '-c:v', 'mjpeg', '-'], 'buffer')
  const buffer = Buffer.isBuffer(frame.stdout) ? frame.stdout : Buffer.from(String(frame.stdout))
  if (!buffer.length) return null
  if (buffer.length > MAX_COVER_BYTES) {
    logger.info('cover', `内嵌封面 ${Math.round(buffer.length / 1024)}KB 超过缩略图上限，改走截帧`)
    return null
  }
  return `data:image/jpeg;base64,${buffer.toString('base64')}`
}
