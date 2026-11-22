import { describe, expect, it } from 'vitest'
import { parseStereoFromProbe } from '../electron/stereo-detect'

// Matroska：stereo_mode 是 stream TAG
const matroskaSbs = JSON.stringify({
  streams: [{ codec_name: 'hevc', tags: { stereo_mode: 'side_by_side_left_first', language: 'jpn' } }]
})
// MP4：stereo 信息在 side_data_list
const mp4Tb = JSON.stringify({
  streams: [{ codec_name: 'avc1', side_data_list: [{ side_data_type: 'Stereoscopic 3D', stereo_mode: 'top_and_bottom' }] }]
})
// VR180：球面投影标记
const spherical = JSON.stringify({
  streams: [{ codec_name: 'hevc', side_data_list: [{ side_data_type: 'Spherical Mapping', projection: 'equirectangular' }] }]
})

describe('parseStereoFromProbe', () => {
  it('Matroska stereo_mode TAG → 平面左右并排', () => {
    expect(parseStereoFromProbe(matroskaSbs)).toEqual({ layout: 'sbs', output: 'left', projection: 'flat' })
  })

  it('MP4 Stereoscopic 3D side_data → 平面上下排列', () => {
    expect(parseStereoFromProbe(mp4Tb)).toEqual({ layout: 'tb', output: 'left', projection: 'flat' })
  })

  it('球面 / equirectangular → 球面 VR180（优先于普通立体）', () => {
    const both = JSON.stringify({
      streams: [{ side_data_list: [{ side_data_type: 'Stereoscopic 3D', stereo_mode: 'side_by_side' }, { side_data_type: 'Spherical Mapping', projection: 'equirectangular' }] }]
    })
    expect(parseStereoFromProbe(both)).toEqual({ layout: 'sbs', output: 'left', projection: 'sphere' })
    expect(parseStereoFromProbe(spherical)).toEqual({ layout: 'sbs', output: 'left', projection: 'sphere' })
  })

  it('立体标记但排布未识别 → 按最常见的 SBS 预选', () => {
    expect(parseStereoFromProbe(JSON.stringify({ streams: [{ side_data_list: [{ side_data_type: 'Stereoscopic 3D' }] }] })))
      .toEqual({ layout: 'sbs', output: 'left', projection: 'flat' })
  })

  it('无立体标记的普通视频 → null（保持现状）', () => {
    expect(parseStereoFromProbe(JSON.stringify({ streams: [{ codec_name: 'avc1', width: 1920 }] }))).toBeNull()
    expect(parseStereoFromProbe('')).toBeNull()
  })

  it('JSON 解析失败时退回原文关键词扫描', () => {
    expect(parseStereoFromProbe('stereo_mode=side_by_side_left_first')).toEqual({ layout: 'sbs', output: 'left', projection: 'flat' })
  })

  it('关键词大小写不敏感', () => {
    expect(parseStereoFromProbe(JSON.stringify({ streams: [{ tags: { STEREO_MODE: 'Top_And_Bottom' } }] })))
      .toEqual({ layout: 'tb', output: 'left', projection: 'flat' })
  })
})
