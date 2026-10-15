// 集成验证：真实 ffmpeg 提取内嵌封面（B7）。本机没有 ffmpeg 时整体跳过。
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { extractEmbeddedCover, pickCoverStream } from '../electron/cover-art'

const run = promisify(execFile)

function findBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const explicit = process.env[`${name.toUpperCase()}_PATH`]
  if (explicit && existsSync(explicit)) return explicit
  const appData = process.env.APPDATA
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const bundled = appData ? join(appData, 'btviewer', 'bin', exe) : ''
  if (bundled && existsSync(bundled)) return bundled
  return null
}

const ffmpeg = findBinary('ffmpeg')
const ffprobe = findBinary('ffprobe')

describe.skipIf(!ffmpeg || !ffprobe)('内嵌封面：真实 ffmpeg 端到端', () => {
  it('带封面附件的 MKV 能抽出一张 JPEG 封面；普通视频返回 null', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'btviewer-cover-'))
    const cover = join(dir, 'cover.jpg')
    const video = join(dir, 'plain.mkv')
    const withCover = join(dir, 'with-cover.mkv')
    try {
      // 造封面图与一段普通视频，再把封面作为附件挂进 mkv
      await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#3b4a63:s=120x68', '-frames:v', '1', '-y', cover], { windowsHide: true })
      await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', video], { windowsHide: true })
      await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-i', video, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-disposition:v:1', 'attached_pic', '-y', withCover], { windowsHide: true })

      // 探测层：确认识别到 attached_pic 流
      const { stdout } = await run(ffprobe!, ['-v', 'quiet', '-print_format', 'json', '-show_streams', withCover], { maxBuffer: 8 * 1024 * 1024, windowsHide: true })
      expect(pickCoverStream(stdout)).not.toBeNull()

      // 提取器按 FFMPEG_PATH → 应用内目录 → PATH 找二进制；单测环境没有 Electron，这里显式指定
      const previous = process.env.FFMPEG_PATH
      process.env.FFMPEG_PATH = ffmpeg!
      let dataUrl: string | null
      try {
        dataUrl = await extractEmbeddedCover(withCover)
      } finally {
        if (previous === undefined) delete process.env.FFMPEG_PATH
        else process.env.FFMPEG_PATH = previous
      }
      expect(dataUrl).toMatch(/^data:image\/jpeg;base64,/)
      // 解出的字节应是合法 JPEG（FFD8 起始、FFD9 结束）
      const bytes = Buffer.from(String(dataUrl).split(',')[1], 'base64')
      expect(bytes.length).toBeGreaterThan(200)
      expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8')
      expect(bytes.subarray(-2).toString('hex')).toBe('ffd9')

      // 没有封面附件的文件不应误报
      process.env.FFMPEG_PATH = ffmpeg!
      try { expect(await extractEmbeddedCover(video)).toBeNull() } finally { delete process.env.FFMPEG_PATH }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)
})
