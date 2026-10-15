// 兼容播放（B1）：内置播放器（Chromium）解不了的编码，用 ffmpeg 转封装/转码成能播的文件。
// 这里只有「探测结果解析 + 决策 + 命令行拼装 + 进度解析」等纯逻辑（可单测），
// 真正拉起 ffmpeg 的操作在 torrent-engine 里完成。

import { isImageCodec } from './cover-art'

// Chromium <video> 的实际能力边界：能直接解码的视频编码
const MP4_VIDEO = ['h264', 'vp9', 'av1']
const WEBM_VIDEO = ['vp8', 'vp9', 'av1']
const MP4_AUDIO = ['aac', 'mp3']
const WEBM_AUDIO = ['opus', 'vorbis']

export interface MediaAudioTrack {
  index: number
  codec: string
  language: string
  title: string
  channels: number
}

export interface MediaStreams {
  // 首个视频流编码；纯音频文件为空串
  video: string
  audio: string[]
  audioTracks: MediaAudioTrack[]
  durationSeconds: number
}

export type CompatMode = 'copy' | 'audio' | 'video'

export interface CompatPlan {
  mode: CompatMode
  container: 'mp4' | 'webm'
  args: string[]
  reason: string
}

// 探测文本解析（ffmpeg -i 的 stderr 兜底路径：ffprobe 不可用时）
export function parseMediaInfo(text: string): MediaStreams {
  const streams: MediaStreams = { video: '', audio: [], audioTracks: [], durationSeconds: 0 }
  const duration = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
  if (duration) streams.durationSeconds = Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
  // 形如 "Stream #0:1(eng): Audio: ac3, 48000 Hz, 5.1, fltp, 448 kb/s"
  const streamRe = /Stream #\d+:(\d+)(?:\(([^)]*)\))?(?:\[[^\]]*\])?[^:]*:\s*(Video|Audio):\s*([A-Za-z0-9_]+)([^\n]*)/g
  let match: RegExpExecArray | null
  while ((match = streamRe.exec(text))) {
    const index = Number(match[1])
    const language = match[2] || ''
    const codec = match[4].toLowerCase()
    // 内嵌封面也是「视频流」（mjpeg/png 附件），不能当成主视频
    if (match[3] === 'Video' && !/attached\s*pic/i.test(match[5]) && !isImageCodec(codec) && !streams.video) streams.video = codec
    else if (match[3] === 'Audio') {
      streams.audio.push(codec)
      const channels = /(\d\.\d|\d)\s*(?:ch|Hz)/i.test(match[5]) ? Number(/(\d\.\d|\d)/.exec(match[5])?.[1] || 0) : 0
      streams.audioTracks.push({ index, codec, language, title: '', channels })
    }
  }
  return streams
}

// 首选路径：ffprobe -print_format json（编码名与时长都是结构化字段，不受本地化影响）
export function parseProbeJson(json: string): MediaStreams {
  const parsed = JSON.parse(json) as { streams?: Array<{ index?: number; codec_type?: string; codec_name?: string; channels?: number; tags?: { language?: string; title?: string }; disposition?: { attached_pic?: number } }>; format?: { duration?: string } }
  const streams: MediaStreams = { video: '', audio: [], audioTracks: [], durationSeconds: 0 }
  for (const stream of parsed.streams || []) {
    const codec = (stream.codec_name || '').toLowerCase()
    if (!codec) continue
    if (stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1 && !isImageCodec(codec) && !streams.video) streams.video = codec
    else if (stream.codec_type === 'audio') {
      streams.audio.push(codec)
      streams.audioTracks.push({ index: stream.index ?? streams.audio.length - 1, codec, language: stream.tags?.language || '', title: stream.tags?.title || '', channels: stream.channels || 0 })
    }
  }
  const duration = Number(parsed.format?.duration)
  streams.durationSeconds = Number.isFinite(duration) && duration > 0 ? duration : 0
  return streams
}

export function probeCommand(input: string): string[] {
  return ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', input]
}

// ffmpeg 命令行；只取首条视频轨与指定音轨（内置播放器不支持切轨），丢弃字幕与数据流
export function compatCommand(input: string, output: string, plan: CompatPlan, audioIndex = 0): string[] {
  const audioSelector = Number.isFinite(audioIndex) && audioIndex > 0 ? `0:a:${Math.floor(audioIndex)}?` : '0:a:0?'
  const args = ['-hide_banner', '-nostats', '-loglevel', 'error', '-progress', 'pipe:1', '-i', input, '-map', '0:v:0?', '-map', audioSelector, '-sn', '-dn', ...plan.args]
  if (plan.container === 'mp4') args.push('-movflags', '+faststart')
  args.push('-y', output)
  return args
}

// -progress 的输出：out_time_us / out_time_ms（历史上后者也是微秒）与 progress=end
export function parseFfmpegProgress(line: string): { outSeconds?: number; done?: boolean } {
  const index = line.indexOf('=')
  if (index < 0) return {}
  const key = line.slice(0, index).trim()
  const value = line.slice(index + 1).trim()
  if (key === 'out_time_us' || key === 'out_time_ms') {
    const micros = Number(value)
    return Number.isFinite(micros) ? { outSeconds: micros / 1_000_000 } : {}
  }
  if (key === 'progress') return { done: value === 'end' }
  return {}
}

// 探测结果 → 转封装/转码方案。audioIndex 指定保留哪条音轨（Chromium 不支持切轨，只能在这里定）
export function planCompatPlayback(streams: MediaStreams, audioIndex = 0): CompatPlan {
  const video = streams.video.toLowerCase()
  const selected = streams.audio[Number.isFinite(audioIndex) && audioIndex >= 0 ? Math.floor(audioIndex) : 0]
  // 只按「被选中的那条音轨」决策：选中的若是 AC3，就要转码，不能因为首轨是 AAC 而误判为可复制
  const audio = selected ? [selected.toLowerCase()] : []
  const mp4AudioOk = audio.every((item) => MP4_AUDIO.includes(item))
  const webmAudioOk = audio.every((item) => WEBM_AUDIO.includes(item))
  const videoIn = (list: string[]) => !!video && list.includes(video)

  // 纯音频：容器不兼容时无损转封装，音轨也不兼容才转码
  if (!video) {
    if (mp4AudioOk) return { mode: 'copy', container: 'mp4', args: ['-c', 'copy'], reason: '容器不兼容，无损转封装为 M4A/MP4' }
    if (webmAudioOk) return { mode: 'copy', container: 'webm', args: ['-c', 'copy'], reason: '容器不兼容，无损转封装为 WebM' }
    return { mode: 'audio', container: 'mp4', args: ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'], reason: `音频编码 ${audio.join('/')} 不支持，转码为 AAC` }
  }
  if (videoIn(MP4_VIDEO) && mp4AudioOk) {
    return { mode: 'copy', container: 'mp4', args: ['-c', 'copy'], reason: audio.length ? `容器或音轨（${audio.join('/')}）不兼容，无损转封装为 MP4` : '容器不兼容，无损转封装为 MP4' }
  }
  if (videoIn(WEBM_VIDEO) && webmAudioOk) {
    return { mode: 'copy', container: 'webm', args: ['-c', 'copy'], reason: '容器或音轨不兼容，无损转封装为 WebM' }
  }
  if (videoIn(MP4_VIDEO)) {
    return { mode: 'audio', container: 'mp4', args: ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'], reason: `音频编码 ${audio.join('/')} 不支持，仅转码音轨为 AAC（画质无损）` }
  }
  if (videoIn(WEBM_VIDEO)) {
    return { mode: 'audio', container: 'webm', args: ['-c:v', 'copy', '-c:a', 'libopus', '-b:a', '160k'], reason: '音轨不兼容，仅转码音轨为 Opus（画质无损）' }
  }
  return {
    mode: 'video',
    container: 'mp4',
    args: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', ...(mp4AudioOk ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '192k', '-ac', '2'])],
    reason: `视频编码 ${video} 内置播放器不支持，转码为 H.264${mp4AudioOk ? '（音频直接复制）' : ' + AAC'}`
  }
}
