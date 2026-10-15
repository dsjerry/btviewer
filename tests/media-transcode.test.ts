import { describe, expect, it } from 'vitest'
import { compatCommand, parseFfmpegProgress, parseMediaInfo, parseProbeJson, planCompatPlayback } from '../electron/media-transcode'

describe('parseMediaInfo（ffmpeg -i 文本兜底）', () => {
  it('解析时长与音视频编码', () => {
    const text = [
      'Input #0, matroska,webm, from \'movie.mkv\':',
      '  Duration: 01:23:45.67, start: 0.000000, bitrate: 5000 kb/s',
      '  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 5000 kb/s, 25 fps',
      '  Stream #0:1(eng): Audio: ac3, 48000 Hz, 5.1(side), fltp, 448 kb/s',
      '  Stream #0:2(chi): Subtitle: subrip'
    ].join('\n')
    const streams = parseMediaInfo(text)
    expect(streams.video).toBe('h264')
    expect(streams.audio).toEqual(['ac3'])
    expect(streams.durationSeconds).toBeCloseTo(5025.67, 2)
  })

  it('多个音轨全部收集，纯音频文件 video 为空', () => {
    const streams = parseMediaInfo('  Stream #0:0: Audio: flac, 44100 Hz, stereo\n  Stream #0:1: Audio: aac, 48000 Hz, stereo')
    expect(streams.video).toBe('')
    expect(streams.audio).toEqual(['flac', 'aac'])
    expect(streams.durationSeconds).toBe(0)
  })
})

describe('parseProbeJson', () => {
  it('按 codec_type 归类并取 format.duration', () => {
    const json = JSON.stringify({
      streams: [{ codec_type: 'video', codec_name: 'hevc' }, { codec_type: 'audio', codec_name: 'eac3' }, { codec_type: 'subtitle', codec_name: 'subrip' }],
      format: { duration: '120.5' }
    })
    const streams = parseProbeJson(json)
    expect(streams).toMatchObject({ video: 'hevc', audio: ['eac3'], durationSeconds: 120.5 })
  })

  it('时长为 0 或缺失时退化为 0', () => {
    expect(parseProbeJson(JSON.stringify({ streams: [], format: { duration: 'N/A' } })).durationSeconds).toBe(0)
    expect(parseProbeJson('{"streams":[]}').durationSeconds).toBe(0)
  })

  it('收集音轨清单（索引/语言/标题/声道）', () => {
    const json = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'h264' },
        { index: 1, codec_type: 'audio', codec_name: 'aac', channels: 2, tags: { language: 'jpn', title: '日语' } },
        { index: 2, codec_type: 'audio', codec_name: 'ac3', channels: 6, tags: { language: 'chi' } }
      ]
    })
    const streams = parseProbeJson(json)
    expect(streams.audio).toEqual(['aac', 'ac3'])
    expect(streams.audioTracks).toEqual([
      { index: 1, codec: 'aac', language: 'jpn', title: '日语', channels: 2 },
      { index: 2, codec: 'ac3', language: 'chi', title: '', channels: 6 }
    ])
  })

  it('内嵌封面（attached_pic）不算主视频流', () => {
    const json = JSON.stringify({
      streams: [
        { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
        { index: 1, codec_type: 'video', codec_name: 'hevc' },
        { index: 2, codec_type: 'audio', codec_name: 'aac' }
      ]
    })
    expect(parseProbeJson(json).video).toBe('hevc')
  })
})

describe('planCompatPlayback', () => {
  it('容器不兼容但编码都能放 → 无损转封装', () => {
    const plan = planCompatPlayback({ video: 'h264', audio: ['aac'], durationSeconds: 10 })
    expect(plan.mode).toBe('copy')
    expect(plan.container).toBe('mp4')
    expect(plan.args).toEqual(['-c', 'copy'])
  })

  it('HEVC 视频 → 转码 H.264，音频可放则复制', () => {
    const plan = planCompatPlayback({ video: 'hevc', audio: ['aac'], durationSeconds: 10 })
    expect(plan.mode).toBe('video')
    expect(plan.args).toContain('libx264')
    expect(plan.args).toContain('copy')
    expect(plan.reason).toContain('hevc')
  })

  it('AC3/DTS 音轨 → 只转码音轨，画质无损', () => {
    const plan = planCompatPlayback({ video: 'h264', audio: ['dts'], durationSeconds: 10 })
    expect(plan.mode).toBe('audio')
    expect(plan.args).toEqual(['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'])
    expect(plan.reason).toContain('dts')
  })

  it('VP8 + Opus → WebM 无损转封装', () => {
    const plan = planCompatPlayback({ video: 'vp8', audio: ['opus'], durationSeconds: 10 })
    expect(plan.mode).toBe('copy')
    expect(plan.container).toBe('webm')
  })

  it('VP9 + AC3 → 优先 MP4 容器，只转音轨为 AAC', () => {
    const plan = planCompatPlayback({ video: 'vp9', audio: ['ac3'], durationSeconds: 10 })
    expect(plan.mode).toBe('audio')
    expect(plan.container).toBe('mp4')
    expect(plan.args).toEqual(['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'])
  })

  it('VP9 + Opus（音频只适配 WebM）→ WebM 容器', () => {
    const plan = planCompatPlayback({ video: 'vp9', audio: ['opus'], durationSeconds: 10 })
    expect(plan.mode).toBe('copy')
    expect(plan.container).toBe('webm')
  })

  it('纯音频且音频不兼容 → 只转音轨', () => {
    const plan = planCompatPlayback({ video: '', audio: ['ac3'], durationSeconds: 10 })
    expect(plan.mode).toBe('audio')
    expect(plan.args).toEqual(['-c:a', 'aac', '-b:a', '192k', '-ac', '2'])
  })

  it('hevc + dts → 视频与音频都转码', () => {
    const plan = planCompatPlayback({ video: 'hevc', audio: ['dts'], durationSeconds: 10, audioTracks: [] })
    expect(plan.mode).toBe('video')
    expect(plan.args).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ac', '2'])
  })

  it('多音轨：按被选中的那条决策（首轨可复制、次轨是 AC3 时仍要转码）', () => {
    const streams = { video: 'h264', audio: ['aac', 'ac3'], audioTracks: [], durationSeconds: 10 }
    expect(planCompatPlayback(streams, 0).args).toEqual(['-c', 'copy'])
    expect(planCompatPlayback(streams, 1).mode).toBe('audio')
    expect(planCompatPlayback(streams, 1).args).toContain('aac')
  })

  it('音轨索引越界时退回首轨', () => {
    const streams = { video: 'h264', audio: ['aac'], audioTracks: [], durationSeconds: 10 }
    expect(planCompatPlayback(streams, 5).mode).toBe('copy')
  })
})

describe('compatCommand', () => {
  it('只取首条音视频轨、丢弃字幕，mp4 追加 faststart', () => {
    const plan = planCompatPlayback({ video: 'h264', audio: ['aac'], durationSeconds: 10 })
    const args = compatCommand('in.mkv', 'out.mp4', plan)
    expect(args).toContain('-map')
    expect(args[args.indexOf('-map') + 1]).toBe('0:v:0?')
    expect(args).toContain('-sn')
    expect(args).toContain('-movflags')
    expect(args[args.length - 1]).toBe('out.mp4')
    expect(args[args.length - 2]).toBe('-y')
  })

  it('webm 输出不加 mp4 的 faststart', () => {
    const plan = planCompatPlayback({ video: 'vp8', audio: ['opus'], durationSeconds: 10, audioTracks: [] })
    expect(compatCommand('in.mkv', 'out.webm', plan)).not.toContain('-movflags')
  })

  it('指定音轨索引时映射到对应的音频流', () => {
    const plan = planCompatPlayback({ video: 'h264', audio: ['aac', 'ac3'], audioTracks: [], durationSeconds: 10 }, 1)
    const args = compatCommand('in.mkv', 'out.mp4', plan, 1)
    expect(args[args.indexOf('-map') + 1]).toBe('0:v:0?')
    expect(args[args.indexOf('-map', args.indexOf('-map') + 1) + 1]).toBe('0:a:1?')
  })
})

describe('parseFfmpegProgress', () => {
  it('out_time_us / out_time_ms 都按微秒换算成秒', () => {
    expect(parseFfmpegProgress('out_time_us=5000000')).toEqual({ outSeconds: 5 })
    expect(parseFfmpegProgress('out_time_ms=2500000')).toEqual({ outSeconds: 2.5 })
  })

  it('progress=end 表示结束', () => {
    expect(parseFfmpegProgress('progress=end')).toEqual({ done: true })
    expect(parseFfmpegProgress('progress=continue')).toEqual({ done: false })
  })

  it('无关行返回空对象', () => {
    expect(parseFfmpegProgress('frame=123')).toEqual({})
    expect(parseFfmpegProgress('')).toEqual({})
    expect(parseFfmpegProgress('out_time_us=abc')).toEqual({})
  })
})
