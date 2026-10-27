import { describe, expect, it } from 'vitest'
import { buildBtTrackers, mergeTrackers, splitTrackers, trackersFromMagnet } from '../electron/tracker-merge'

// aria2 的 bt-tracker 会整体替换磁力自带的 tracker，这里保证「自带优先 + 公共兜底」

describe('trackersFromMagnet', () => {
  it('取出全部 &tr= 并解码', () => {
    const magnet = 'magnet:?xt=urn:btih:abc&dn=Movie&tr=udp%3A%2F%2Ftracker.a.org%3A1337%2Fannounce&tr=https%3A%2F%2Ftracker.b.com%2Fannounce'
    expect(trackersFromMagnet(magnet)).toEqual([
      'udp://tracker.a.org:1337/announce',
      'https://tracker.b.com/announce'
    ])
  })

  it('支持多个 &tr= 且保持顺序', () => {
    const magnet = 'magnet:?xt=urn:btih:abc&tr=udp://t1/announce&tr=udp://t2/announce&tr=udp://t3/announce'
    expect(trackersFromMagnet(magnet)).toEqual(['udp://t1/announce', 'udp://t2/announce', 'udp://t3/announce'])
  })

  it('没有 tracker、不是磁力链接或非法转义时返回空/原文', () => {
    expect(trackersFromMagnet('magnet:?xt=urn:btih:abc&dn=x')).toEqual([])
    expect(trackersFromMagnet('https://example.com/a.torrent')).toEqual([])
    expect(trackersFromMagnet('magnet:?tr=udp%2F%2Fbad%ZZ')).toEqual(['udp%2F%2Fbad%ZZ'])
  })

  it('忽略大小写不同的 tr 参数名', () => {
    expect(trackersFromMagnet('magnet:?TR=udp://t/announce')).toEqual(['udp://t/announce'])
  })
})

describe('mergeTrackers', () => {
  it('任务自带的排在公共 tracker 前面', () => {
    expect(mergeTrackers(['udp://private/announce'], ['udp://public/announce']))
      .toEqual(['udp://private/announce', 'udp://public/announce'])
  })

  it('去重（忽略大小写与结尾斜杠）', () => {
    expect(mergeTrackers(['UDP://Track.A.org/announce/'], ['udp://track.a.org/announce', 'udp://other/announce']))
      .toEqual(['UDP://Track.A.org/announce/', 'udp://other/announce'])
  })

  it('空值与空白被丢弃', () => {
    expect(mergeTrackers(['', '  ', 'udp://a/announce'], [''])).toEqual(['udp://a/announce'])
  })
})

describe('buildBtTrackers', () => {
  it('磁力自带 tracker 优先，再补公共列表', () => {
    const magnet = 'magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Fown%3A1337%2Fannounce'
    expect(buildBtTrackers(magnet, ['udp://public/announce']))
      .toEqual(['udp://own:1337/announce', 'udp://public/announce'])
  })

  it('没有磁力（.torrent 或直链）时只用公共列表', () => {
    expect(buildBtTrackers(undefined, ['udp://public/announce'])).toEqual(['udp://public/announce'])
  })

  it('磁力里的 tracker 与公共列表重复时只保留一次', () => {
    const magnet = 'magnet:?xt=urn:btih:abc&tr=udp%3A%2F%2Fdup%2Fannounce'
    expect(buildBtTrackers(magnet, ['udp://dup/announce', 'udp://extra/announce']))
      .toEqual(['udp://dup/announce', 'udp://extra/announce'])
  })
})

describe('splitTrackers', () => {
  it('支持逗号、空格、换行分隔', () => {
    expect(splitTrackers('udp://a/announce, udp://b/announce\nudp://c/announce  '))
      .toEqual(['udp://a/announce', 'udp://b/announce', 'udp://c/announce'])
  })
})
