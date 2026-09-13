import { describe, expect, it } from 'vitest'
import { extractMagnet, matchKeywords, parseFeedItems, parseSeason } from '../electron/rss-parse'

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>示例番剧</title>
<item><title>示例番剧 S02E05 1080p 简体内嵌</title><link>https://example.com/t/1</link><guid>guid-1</guid><pubDate>Mon, 01 Sep 2026 00:00:00 GMT</pubDate>
<enclosure url="magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10" type="application/x-bittorrent" length="1"/></item>
<item><title>另一部剧 第03季 第01集</title><link>magnet:?xt=urn:btih:2DD9DE911E0AEADCE51C9A6D6DF96B21C0524458&amp;tr=udp%3A%2F%2Ftracker.example.org%3A1337</link><guid>guid-2</guid></item>
<item><title>普通资源包</title><link>https://example.com/t/3</link><guid>guid-3</guid><description>说明文字 magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&amp;dn=test 藏在描述里</description></item>
<item><title>种子文件直链</title><link>https://example.com/files/pkg.torrent</link><guid>guid-4</guid><enclosure url="https://example.com/files/pkg.torrent" type="application/x-bittorrent"/></item>
</channel></rss>`

const ATOM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Atom 条目</title><id>atom-1</id><link rel="alternate" type="text/html" href="https://example.com/a/1"/><summary>magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff</summary><updated>2026-09-01T00:00:00Z</updated></entry>
</feed>`

describe('parseFeedItems', () => {
  it('parses RSS items with magnet enclosures', () => {
    const items = parseFeedItems(RSS_XML)
    expect(items).toHaveLength(4)
    expect(items[0]).toMatchObject({ guid: 'guid-1', title: '示例番剧 S02E05 1080p 简体内嵌', magnet: 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10' })
  })
  it('prefers the item link when it is a magnet and decodes entities', () => {
    const items = parseFeedItems(RSS_XML)
    expect(items[1].magnet).toBe('magnet:?xt=urn:btih:2DD9DE911E0AEADCE51C9A6D6DF96B21C0524458&tr=udp%3A%2F%2Ftracker.example.org%3A1337')
  })
  it('scans the description for magnets and keeps torrent URLs', () => {
    const items = parseFeedItems(RSS_XML)
    expect(items[2].magnet).toBe('magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=test')
    expect(items[3].magnet).toBe('')
    expect(items[3].torrentUrl).toBe('https://example.com/files/pkg.torrent')
  })
  it('parses Atom entries via summary fallback', () => {
    const items = parseFeedItems(ATOM_XML)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ guid: 'atom-1', magnet: 'magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff', pubDate: '2026-09-01T00:00:00Z' })
  })
  it('returns empty for broken XML', () => {
    expect(parseFeedItems('<rss><channel><item>')).toEqual([])
  })
})

describe('matchKeywords', () => {
  it('matches when every keyword hits case-insensitively', () => {
    expect(matchKeywords('Show S01E01 1080p 简体', ['1080P', '简体'])).toBe(true)
    expect(matchKeywords('Show S01E01 720p 简体', ['1080p', '简体'])).toBe(false)
  })
  it('treats empty keywords as match-all', () => {
    expect(matchKeywords('anything', [])).toBe(true)
  })
})

describe('parseSeason', () => {
  it('reads SxxExx, Chinese, English and NxNN forms', () => {
    expect(parseSeason('Show S02E05')).toBe(2)
    expect(parseSeason('某剧 第12季')).toBe(12)
    expect(parseSeason('Show Season 3 EP1')).toBe(3)
    expect(parseSeason('Show 4x01')).toBe(4)
  })
  it('returns null without season info', () => {
    expect(parseSeason('随便一个标题 2026')).toBeNull()
  })
})

describe('extractMagnet', () => {
  it('extracts a magnet from arbitrary text', () => {
    expect(extractMagnet('前缀 magnet:?xt=urn:btih:abcdefabcdefabcdefabcdefabcdefabcdef12&dn=x 后缀')).toBe('magnet:?xt=urn:btih:abcdefabcdefabcdefabcdefabcdefabcdef12&dn=x')
    expect(extractMagnet('没有链接')).toBe('')
  })
})
