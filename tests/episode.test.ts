import { describe, expect, it } from 'vitest'
import { compareEpisodes, episodeLabel, parseEpisode, seriesKey } from '../src/services/episode'

describe('parseEpisode', () => {
  it('识别 S01E02 家族', () => {
    expect(parseEpisode('Show.S01E02.1080p.mkv')).toEqual({ season: 1, episode: 2 })
    expect(parseEpisode('Show.S1E2.720p.mkv')).toEqual({ season: 1, episode: 2 })
    expect(parseEpisode('Show.s01.e02.mkv')).toEqual({ season: 1, episode: 2 })
    expect(parseEpisode('Show.S01E102.mkv')).toEqual({ season: 1, episode: 102 })
  })

  it('识别 1x02', () => {
    expect(parseEpisode('Show.1x02.HDTV.avi')).toEqual({ season: 1, episode: 2 })
    expect(parseEpisode('Show 12x03.mkv')).toEqual({ season: 12, episode: 3 })
  })

  it('识别中文命名', () => {
    expect(parseEpisode('某剧 第2季第15集.mkv')).toEqual({ season: 2, episode: 15 })
    expect(parseEpisode('某剧 第08话.mp4')).toEqual({ season: 1, episode: 8 })
  })

  it('识别 EP/E 前缀', () => {
    expect(parseEpisode('Show.EP07.1080p.mkv')).toEqual({ season: 1, episode: 7 })
    expect(parseEpisode('Show - E12 - Title.mp4')).toEqual({ season: 1, episode: 12 })
  })

  it('不误伤分辨率与年份', () => {
    expect(parseEpisode('Movie.2014.1080p.BluRay.x264.mkv')).toBeNull()
    expect(parseEpisode('Interstellar.2014.2160p.WEB-DL.mkv')).toBeNull()
    expect(parseEpisode('Some.x265.Release.mkv')).toBeNull()
  })

  it('无季集信息返回 null', () => {
    expect(parseEpisode('Concert.Live.2004.mkv')).toBeNull()
  })
})

describe('seriesKey', () => {
  it('同一部剧的不同集/不同压制版本归到同一个键', () => {
    const a = seriesKey('Planet.Earth.II.S01E03.1080p.BluRay.x264.mkv')
    const b = seriesKey('Planet.Earth.II.S01E10.2160p.WEB-DL.mkv')
    expect(a).toBe('planet earth ii')
    expect(b).toBe(a)
  })

  it('切掉年份与季集标记，保留剧名', () => {
    expect(seriesKey('Cosmos.A.Spacetime.Odyssey.2014.S01.1080p.BluRay.Remux.mkv')).toBe('cosmos a spacetime odyssey')
    expect(seriesKey('某剧 第2季第15集.mkv')).toBe('某剧')
  })

  it('不同剧得到不同的键', () => {
    expect(seriesKey('Show.A.S01E01.mkv')).not.toBe(seriesKey('Show.B.S01E01.mkv'))
  })

  it('没有季集信息时只做归一化', () => {
    expect(seriesKey('Big_Buck_Bunny.2008.1080p.mkv')).toBe('big buck bunny')
  })
})

describe('episodeLabel', () => {
  it('补零成 S01E02 形式', () => {
    expect(episodeLabel({ season: 1, episode: 2 })).toBe('S01E02')
    expect(episodeLabel({ season: 12, episode: 103 })).toBe('S12E103')
    expect(episodeLabel(null)).toBe('')
  })
})

describe('compareEpisodes', () => {
  it('按季、集排序', () => {
    const list = [{ season: 1, episode: 10 }, { season: 2, episode: 1 }, { season: 1, episode: 2 }]
    expect([...list].sort((a, b) => compareEpisodes(a, b))).toEqual([{ season: 1, episode: 2 }, { season: 1, episode: 10 }, { season: 2, episode: 1 }])
  })

  it('无季集信息排在后面，并按名称自然序兜底', () => {
    const items: Array<{ tag: { season: number; episode: number } | null; name: string }> = [
      { tag: null, name: 'b.mkv' },
      { tag: { season: 1, episode: 1 }, name: 'a.mkv' },
      { tag: null, name: 'a10.mkv' },
      { tag: null, name: 'a2.mkv' }
    ]
    const sorted = [...items].sort((a, b) => compareEpisodes(a.tag, b.tag, a.name, b.name))
    expect(sorted.map((item) => item.name)).toEqual(['a.mkv', 'a2.mkv', 'a10.mkv', 'b.mkv'])
  })
})
