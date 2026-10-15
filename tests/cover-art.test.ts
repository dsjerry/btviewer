import { describe, expect, it } from 'vitest'
import { mainVideoCodec, pickCoverStream } from '../electron/cover-art'

const probe = (streams: unknown[]) => JSON.stringify({ streams })

describe('pickCoverStream', () => {
  it('挑出 attached_pic 的视频流（MP4/M4A 的 covr 写法）', () => {
    const json = probe([
      { index: 0, codec_type: 'video', codec_name: 'h264' },
      { index: 1, codec_type: 'audio', codec_name: 'aac' },
      { index: 2, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } }
    ])
    expect(pickCoverStream(json)).toEqual({ index: 2, codec: 'mjpeg' })
  })

  it('挑出图片编码的视频流（MKV 附件被 mkv demuxer 报成普通视频流）', () => {
    const json = probe([
      { index: 0, codec_type: 'video', codec_name: 'hevc' },
      { index: 1, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 0 } }
    ])
    expect(pickCoverStream(json)).toEqual({ index: 1, codec: 'mjpeg' })
  })

  it('挑出 codec_type=attachment 的流', () => {
    expect(pickCoverStream(probe([{ index: 3, codec_type: 'attachment', codec_name: 'png' }]))).toEqual({ index: 3, codec: 'png' })
  })

  it('没有封面流时返回 null（普通视频、纯音频、字幕）', () => {
    expect(pickCoverStream(probe([{ index: 0, codec_type: 'video', codec_name: 'h264', disposition: { attached_pic: 0 } }]))).toBeNull()
    expect(pickCoverStream(probe([{ index: 0, codec_type: 'audio', codec_name: 'flac' }]))).toBeNull()
    expect(pickCoverStream('not json')).toBeNull()
    expect(pickCoverStream(probe([]))).toBeNull()
  })

  it('attached_pic 但缺 index 时视为无效', () => {
    expect(pickCoverStream(probe([{ codec_type: 'video', codec_name: 'png', disposition: { attached_pic: 1 } }]))).toBeNull()
  })
})

describe('mainVideoCodec', () => {
  it('忽略封面流，取真实视频编码', () => {
    const json = probe([
      { index: 0, codec_type: 'video', codec_name: 'mjpeg', disposition: { attached_pic: 1 } },
      { index: 1, codec_type: 'video', codec_name: 'hevc' },
      { index: 2, codec_type: 'audio', codec_name: 'eac3' }
    ])
    expect(mainVideoCodec(json)).toBe('hevc')
  })

  it('封面排在前面时也不会被当成主视频', () => {
    const json = probe([
      { index: 0, codec_type: 'video', codec_name: 'png' },
      { index: 1, codec_type: 'video', codec_name: 'h264' }
    ])
    expect(mainVideoCodec(json)).toBe('h264')
  })

  it('没有视频流时返回空串', () => {
    expect(mainVideoCodec(probe([{ index: 0, codec_type: 'audio', codec_name: 'mp3' }]))).toBe('')
    expect(mainVideoCodec('nope')).toBe('')
  })
})
