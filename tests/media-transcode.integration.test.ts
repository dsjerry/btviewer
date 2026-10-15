// 集成验证：用真实 ffmpeg 跑通「探测 → 决策 → 执行」链路（B1 兼容播放）。
// 本机没有 ffmpeg 时整体跳过，因此不会拖垮常规 `npm test`。
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { compatCommand, parseProbeJson, planCompatPlayback, probeCommand } from '../electron/media-transcode'

const run = promisify(execFile)

function findBinary(name: 'ffmpeg' | 'ffprobe'): string | null {
  const explicit = process.env[name.toUpperCase() + '_PATH']
  if (explicit && existsSync(explicit)) return explicit
  const appData = process.env.APPDATA
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const bundled = appData ? join(appData, 'btviewer', 'bin', exe) : ''
  if (bundled && existsSync(bundled)) return bundled
  return null
}

const ffmpeg = findBinary('ffmpeg')
const ffprobe = findBinary('ffprobe')

async function probe(file: string) {
  const { stdout } = await run(ffprobe!, probeCommand(file), { maxBuffer: 8 * 1024 * 1024, windowsHide: true })
  return parseProbeJson(stdout)
}

describe.skipIf(!ffmpeg || !ffprobe)('兼容播放：真实 ffmpeg 端到端', () => {
  it('mpeg4+ac3 的 mkv → 探测、决策、转码出 Chromium 可播的 mp4', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'btviewer-compat-'))
    const input = join(dir, 'bad.mkv')
    const output = join(dir, 'good.mp4')
    try {
      // 造一个内置播放器放不了的文件：mpeg4 视频 + ac3 音轨 + mkv 容器
      await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-c:v', 'mpeg4', '-c:a', 'ac3', '-shortest', '-y', input], { windowsHide: true })

      const streams = await probe(input)
      expect(streams.video).toBe('mpeg4')
      expect(streams.audio).toContain('ac3')
      expect(streams.durationSeconds).toBeGreaterThan(3)

      const plan = planCompatPlayback(streams)
      expect(plan.mode).toBe('video')
      expect(plan.container).toBe('mp4')

      const { stdout } = await run(ffmpeg!, compatCommand(input, output, plan), { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
      // -progress pipe:1 会把进度写到 stdout，最后一行应是 progress=end
      expect(stdout).toContain('progress=end')
      expect(statSync(output).size).toBeGreaterThan(1000)

      const produced = await probe(output)
      expect(produced.video).toBe('h264')
      expect(produced.audio).toContain('aac')
      expect(produced.durationSeconds).toBeGreaterThan(3)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)

  it('纯转封装路径：h264+aac 的 mkv → mp4 且编码不变（不重编码）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'btviewer-compat-'))
    const input = join(dir, 'plain.mkv')
    const output = join(dir, 'plain.mp4')
    try {
      await run(ffmpeg!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', '-y', input], { windowsHide: true })

      const streams = await probe(input)
      const plan = planCompatPlayback(streams)
      expect(plan.mode).toBe('copy')

      await run(ffmpeg!, compatCommand(input, output, plan), { windowsHide: true })
      const produced = await probe(output)
      expect(produced.video).toBe('h264')
      expect(produced.audio).toContain('aac')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)

  it('多音轨：选择第二条音轨时输出的音轨语言随之改变', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'btviewer-compat-'))
    const input = join(dir, 'multi.mp4')
    const output = join(dir, 'picked.mp4')
    try {
      // 两条音轨：第一条英文 44.1kHz，第二条日语 48kHz（语言标记用于断言究竟保留了哪条）
      await run(ffmpeg!, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
        '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3:sample_rate=48000',
        '-map', '0:v', '-map', '1:a', '-map', '2:a',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
        '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn',
        '-shortest', '-y', input
      ], { windowsHide: true })

      const streams = await probe(input)
      expect(streams.audioTracks).toHaveLength(2)
      expect(streams.audioTracks.map((track) => track.language)).toEqual(['eng', 'jpn'])

      const plan = planCompatPlayback(streams, 1)
      await run(ffmpeg!, compatCommand(input, output, plan, 1), { windowsHide: true })
      const produced = await probe(output)
      expect(produced.audioTracks).toHaveLength(1)
      expect(produced.audioTracks[0].language).toBe('jpn')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)
})
