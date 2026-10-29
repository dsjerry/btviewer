import { describe, expect, it } from 'vitest'
import { displayNameFromMagnet, filterMetadataPlaceholders, isMetadataPlaceholder, resolveTaskName } from '../electron/torrent-display'

describe('isMetadataPlaceholder', () => {
  it('识别 aria2 的 metadata 占位文件', () => {
    expect(isMetadataPlaceholder('[METADATA]4d4ece0f615d0b6b2ca090261ba4a18348da0b6f')).toBe(true)
    expect(isMetadataPlaceholder('../../Workspace/btviewer/[METADATA]4d4ece0f')).toBe(true)
    expect(isMetadataPlaceholder('/tmp/[METADATA]abc')).toBe(true)
  })

  it('真实文件不算占位', () => {
    expect(isMetadataPlaceholder('/dl/movie.mkv')).toBe(false)
    expect(isMetadataPlaceholder('/dl/movie [METADATA]x.mkv')).toBe(false)
    expect(isMetadataPlaceholder('')).toBe(false)
  })
})

describe('filterMetadataPlaceholders', () => {
  it('去掉占位文件，保留其余', () => {
    const files = [
      { path: '[METADATA]abc', name: 'x' },
      { path: '/dl/movie.mkv', name: 'movie.mkv' }
    ]
    expect(filterMetadataPlaceholders(files)).toEqual([{ path: '/dl/movie.mkv', name: 'movie.mkv' }])
  })

  it('全是占位时返回空数组（界面据此显示「正在获取」而不是文件明细）', () => {
    expect(filterMetadataPlaceholders([{ path: '[METADATA]abc' }])).toEqual([])
  })

  it('没有占位时返回原数组（保持引用，避免无谓重渲染）', () => {
    const files = [{ path: '/dl/a.mkv' }]
    expect(filterMetadataPlaceholders(files)).toBe(files)
    expect(filterMetadataPlaceholders([])).toEqual([])
  })
})

describe('displayNameFromMagnet', () => {
  it('解析 dn= 并解码', () => {
    expect(displayNameFromMagnet('magnet:?xt=urn:btih:abc&dn=%E7%94%B5%E5%BD%B1.mkv')).toBe('电影.mkv')
  })

  it('+ 视为空格', () => {
    expect(displayNameFromMagnet('magnet:?dn=The+Movie')).toBe('The Movie')
  })

  it('没有 dn 或不是磁力时返回空串', () => {
    expect(displayNameFromMagnet('magnet:?xt=urn:btih:abc')).toBe('')
    expect(displayNameFromMagnet('https://example.com')).toBe('')
    expect(displayNameFromMagnet(undefined)).toBe('')
  })

  it('非法转义时退回原文', () => {
    expect(displayNameFromMagnet('magnet:?dn=%ZZbad')).toBe('%ZZbad')
  })
})

describe('resolveTaskName', () => {
  const hash = '4d4ece0f615d0b6b2ca090261ba4a18348da0b6f'

  it('优先级：bt 名称 > dn > 已存名称 > 哈希', () => {
    expect(resolveTaskName({ btName: 'Real', magnet: 'magnet:?dn=FromDn', storedName: 'Stored', hash })).toBe('Real')
    expect(resolveTaskName({ magnet: 'magnet:?dn=FromDn', storedName: 'Stored', hash })).toBe('FromDn')
    expect(resolveTaskName({ storedName: 'Stored', hash })).toBe('Stored')
    expect(resolveTaskName({ hash })).toBe(hash)
  })
})
