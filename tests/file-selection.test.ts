import { describe, expect, it } from 'vitest'
import { companionSubtitleIndexes, mergeSelectFileIndexes } from '../electron/file-selection'

// 「播放单个文件」时顺手选中同名字幕，避免边下边播时字幕迟迟不出现

const files = [
  { index: '1', path: '/dl/task/movie.mkv', type: 'video' },
  { index: '2', path: '/dl/task/movie.zh.srt', type: 'subtitle' },
  { index: '3', path: '/dl/task/movie.en.srt', type: 'subtitle' },
  { index: '4', path: '/dl/task/other.srt', type: 'subtitle' },
  { index: '5', path: '/dl/task/sub/movie.zh.srt', type: 'subtitle' },
  { index: '6', path: '/dl/task/bonus.mkv', type: 'video' }
]

describe('companionSubtitleIndexes', () => {
  it('选中同目录、同前缀的字幕', () => {
    expect(companionSubtitleIndexes(files, '/dl/task/movie.mkv')).toEqual(['2', '3'])
  })

  it('不跨目录、不误选无关字幕', () => {
    const indexes = companionSubtitleIndexes(files, '/dl/task/movie.mkv')
    expect(indexes).not.toContain('4') // other.srt
    expect(indexes).not.toContain('5') // 子目录
  })

  it('前缀匹配要求分隔符：movie 不会匹配 movie2.srt', () => {
    const list = [...files, { index: '7', path: '/dl/task/movie2.srt', type: 'subtitle' }]
    expect(companionSubtitleIndexes(list, '/dl/task/movie.mkv')).not.toContain('7')
  })

  it('播放文件不存在时返回空', () => {
    expect(companionSubtitleIndexes(files, '/dl/task/missing.mkv')).toEqual([])
    expect(companionSubtitleIndexes(files, '')).toEqual([])
  })
})

describe('mergeSelectFileIndexes', () => {
  it('合并并去重', () => {
    expect(mergeSelectFileIndexes(['1', '2'], ['2', '3'])).toBe('1,2,3')
  })
  it('没有额外项时保持原顺序', () => {
    expect(mergeSelectFileIndexes(['3', '1'])).toBe('3,1')
  })
})
