import { describe, expect, it } from 'vitest'
import { pickAutoSubtitle, rankSubtitles, subtitleLanguage, subtitleMatchScore } from '../src/services/subtitle-match'

describe('subtitleLanguage', () => {
  it('识别常见语言标记', () => {
    expect(subtitleLanguage('Show.S01E02.chi.srt')).toBe('中文')
    expect(subtitleLanguage('Show.S01E02.简体.srt')).toBe('中文')
    expect(subtitleLanguage('Show.S01E02.cht.srt')).toBe('繁体')
    expect(subtitleLanguage('Show.S01E02.eng.srt')).toBe('英文')
    expect(subtitleLanguage('Show.S01E02.中英双语.srt')).toBe('双语')
    expect(subtitleLanguage('Show.S01E02.jpn.ass')).toBe('日语')
  })

  it('没有语言标记时返回空串', () => {
    expect(subtitleLanguage('Show.S01E02.srt')).toBe('')
  })
})

describe('subtitleMatchScore', () => {
  it('同名最高分', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01E02.srt')).toBe(100)
  })

  it('同名 + 语言后缀：归一化忽略语言标记，等同名', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01E02.chi.srt')).toBe(100)
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01E02.zh-CN.srt')).toBe(100)
  })

  it('同名带额外后缀（压制信息等）次之', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01E02.1080p.extra.srt')).toBe(90)
  })

  it('集号相同但命名风格不同也算命中', () => {
    expect(subtitleMatchScore('Show.S01E02.1080p.mkv', 'Show.1x02.chs.srt')).toBe(80)
  })

  it('不同集不自动匹配', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01E03.srt')).toBe(0)
  })

  it('整季字幕包是低分候选', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Show.S01.chs.srt')).toBe(60)
  })

  it('别的剧不匹配', () => {
    expect(subtitleMatchScore('Show.S01E02.mkv', 'Other.S01E02.srt')).toBe(0)
  })
})

describe('rankSubtitles', () => {
  const files = [
    { name: 'Show.S01E03.chi.srt', path: '/s/3.srt' },
    { name: 'Show.S01E02.eng.srt', path: '/s/2en.srt' },
    { name: 'Show.S01E02.chi.srt', path: '/s/2.srt' },
    { name: 'Show.S01E02.srt', path: '/s/2plain.srt' },
    { name: 'Other.S01E02.srt', path: '/s/other.srt' }
  ]

  it('按匹配分排序，同档中文优先', () => {
    const ranked = rankSubtitles('Show.S01E02.mkv', files)
    // 0 分候选里，同剧的其它集（中文）排在别的剧之前——面板里用户更容易找到想挂的那条
    expect(ranked.map((item) => item.path)).toEqual(['/s/2.srt', '/s/2en.srt', '/s/2plain.srt', '/s/3.srt', '/s/other.srt'])
    expect(ranked[0].language).toBe('中文')
  })

  it('自动选择只接受达到整季包级别的候选，且同档优先中文', () => {
    expect(pickAutoSubtitle(rankSubtitles('Show.S01E02.mkv', files))?.path).toBe('/s/2.srt')
    // 只有别集的字幕时不自动挂载
    expect(pickAutoSubtitle(rankSubtitles('Show.S01E02.mkv', [{ name: 'Show.S01E03.srt', path: '/s/3.srt' }]))).toBeNull()
    // 只有整季包时也能自动挂上
    expect(pickAutoSubtitle(rankSubtitles('Show.S01E02.mkv', [{ name: 'Show.S01.chs.srt', path: '/s/season.srt' }]))?.path).toBe('/s/season.srt')
  })
})
