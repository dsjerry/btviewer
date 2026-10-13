import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMagnetURI, classifyInput, getFileType, infoHashFromMagnet, isUnderRoot, parseMetalink, srtToVtt, stableKey, torrentInfoHash, trackerList } from '../electron/torrent-engine'

// 引擎模块引入了 electron，但被测的纯逻辑函数不会触达它
vi.mock('electron', () => ({}))

describe('infoHashFromMagnet', () => {
  it('extracts and lowercases the btih hash', () => {
    expect(infoHashFromMagnet('magnet:?xt=urn:btih:2DD9DE911E0AEADCE51C9A6D6DF96B21C0524458')).toBe('2dd9de911e0aeadce51c9a6d6df96b21c0524458')
  })
  it('keeps a hash that already has trackers', () => {
    const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337'
    expect(infoHashFromMagnet(magnet)).toBe('08ada5a7a6183aae1e09d831df6748d566095a10')
  })
  it('returns empty for magnets without a btih hash', () => {
    expect(infoHashFromMagnet('magnet:?xt=urn:btmh:1220abcdef')).toBe('')
    expect(infoHashFromMagnet('not a magnet')).toBe('')
  })
})

describe('isUnderRoot', () => {
  const root = join(tmpdir(), 'btviewer-root-test')
  it('accepts files inside the root', () => {
    expect(isUnderRoot(root, join(root, 'Sintel', 'a.mp4'))).toBe(true)
  })
  it('rejects paths outside the root and the root itself', () => {
    expect(isUnderRoot(root, join(tmpdir(), 'outside.mp4'))).toBe(false)
    expect(isUnderRoot(root, root)).toBe(false)
  })
  it('rejects traversal attempts', () => {
    expect(isUnderRoot(root, join(root, '..', 'escape.mp4'))).toBe(false)
  })
})

describe('torrentInfoHash', () => {
  const tmp = () => mkdtempSync(join(tmpdir(), 'torrent-'))

  it('computes sha1 over the exact info dict bytes', () => {
    const file = join(tmp(), 'sample.torrent')
    const infoDict = 'd6:lengthi4e4:name4:abcde'
    writeFileSync(file, Buffer.from(`d4:info${infoDict}4:url-listlee`))
    const expected = createHash('sha1').update(Buffer.from(infoDict)).digest('hex')
    expect(torrentInfoHash(file)).toBe(expected)
  })

  it('throws for invalid files', () => {
    const file = join(tmp(), 'bad.torrent')
    writeFileSync(file, 'not a torrent')
    expect(() => torrentInfoHash(file)).toThrow()
  })
})

describe('trackerList', () => {
  beforeEach(() => { delete process.env.ARIA2_TRACKERS })

  it('falls back to the built-in snapshot', () => {
    expect(trackerList().startsWith('udp://tracker.opentrackr.org:1337/announce')).toBe(true)
  })
  it('uses ARIA2_TRACKERS when set', () => {
    process.env.ARIA2_TRACKERS = 'udp://env.example/announce'
    expect(trackerList()).toBe('udp://env.example/announce')
  })
  it('prefers the explicit override over env and defaults', () => {
    process.env.ARIA2_TRACKERS = 'udp://env.example/announce'
    expect(trackerList('udp://override.example/announce')).toBe('udp://override.example/announce')
  })
})

describe('getFileType', () => {
  it('classifies media and subtitle extensions', () => {
    expect(getFileType('a.mp4')).toBe('video')
    expect(getFileType('b.FLAC')).toBe('audio')
    expect(getFileType('c.srt')).toBe('subtitle')
    expect(getFileType('d.jpg')).toBe('other')
  })
})

describe('srtToVtt', () => {
  it('prepends the WEBVTT header and converts SRT timestamp commas', () => {
    const srt = '1\n00:00:01,000 --> 00:00:03,500\n你好\n\n2\n00:01:02,250 --> 00:01:04,000\nWorld\n'
    expect(srtToVtt(srt)).toBe('WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.500\n你好\n\n2\n00:01:02.250 --> 00:01:04.000\nWorld\n')
  })
  it('keeps VTT content untouched', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi'
    expect(srtToVtt(vtt)).toBe(vtt)
  })
  it('strips a UTF-8 BOM and keeps comma-free timestamps intact', () => {
    const srt = '\uFEFF00:00:05,200 --> 00:00:06,700\ntext'
    expect(srtToVtt(srt).startsWith('WEBVTT\n\n00:00:05.200')).toBe(true)
  })
})

describe('buildMagnetURI', () => {
  it('builds a magnet with display name and trackers', () => {
    const magnet = buildMagnetURI('08ada5a7a6183aae1e09d831df6748d566095a10', 'Sintel', ['udp://tracker.opentrackr.org:1337/announce'])
    expect(magnet).toBe('magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce')
  })
  it('omits the display name when empty', () => {
    expect(buildMagnetURI('2dd9de911e0aeadce51c9a6d6df96b21c0524458', '')).toBe('magnet:?xt=urn:btih:2dd9de911e0aeadce51c9a6d6df96b21c0524458')
  })
  it('accepts base32 magnet hashes and rejects placeholder gids', () => {
    expect(buildMagnetURI('ABCDEFGHIJKLMNOPQRSTUVWXYZ234567', 'x').startsWith('magnet:?xt=urn:btih:ABCDEFGHIJKLMNOPQRSTUVWXYZ234567')).toBe(true)
    expect(buildMagnetURI('gid-123', 'x')).toBe('')
    expect(buildMagnetURI('', 'x')).toBe('')
  })
})

describe('classifyInput', () => {
  it('routes magnets and torrent files to the bt branch', () => {
    expect(classifyInput('magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10')).toBe('magnet')
    expect(classifyInput('D:\\downloads\\sample.torrent')).toBe('torrent')
    expect(classifyInput('/tmp/sample.TORRENT')).toBe('torrent')
  })
  it('routes direct media and ftp links away from video probing', () => {
    expect(classifyInput('https://example.com/movie.mp4?token=1')).toBe('http')
    expect(classifyInput('https://example.com/archive.zip')).toBe('http')
    expect(classifyInput('ftp://mirror.example.org/ubuntu.iso')).toBe('ftp')
  })
  it('marks non-direct http(s) urls as web for yt-dlp probing', () => {
    expect(classifyInput('https://www.youtube.com/watch?v=abc')).toBe('web')
    expect(classifyInput('https://example.com/page')).toBe('web')
  })
  it('routes metalink files by extension', () => {
    expect(classifyInput('D:\\iso\\ubuntu.metalink')).toBe('metalink')
    expect(classifyInput('/iso/ubuntu.meta4')).toBe('metalink')
  })
  it('rejects empty and unknown inputs', () => {
    expect(classifyInput('   ')).toBe('unknown')
    expect(classifyInput('just some text')).toBe('unknown')
  })
})

describe('stableKey', () => {
  it('produces a stable sha1 key independent of surrounding whitespace', () => {
    const expected = createHash('sha1').update('https://example.com/a.mp4').digest('hex')
    expect(stableKey('https://example.com/a.mp4')).toBe(expected)
    expect(stableKey('  https://example.com/a.mp4  ')).toBe(expected)
  })
})

describe('parseMetalink', () => {
  it('extracts file names and mirror urls', () => {
    const xml = '<metalink xmlns="urn:ietf:params:xml:ns:metalink"><file name="ubuntu.iso"><url priority="1">https://mirror-a.example/ubuntu.iso</url><url priority="2">https://mirror-b.example/ubuntu.iso</url></file><file name="notes.txt"><url>ftp://mirror-c.example/notes.txt</url></file></metalink>'
    const entries = parseMetalink(xml)
    expect(entries).toHaveLength(2)
    expect(entries[0].name).toBe('ubuntu.iso')
    expect(entries[0].urls).toEqual(['https://mirror-a.example/ubuntu.iso', 'https://mirror-b.example/ubuntu.iso'])
    expect(entries[1].urls).toEqual(['ftp://mirror-c.example/notes.txt'])
  })
  it('reads url text when the element carries attributes', () => {
    const xml = '<metalink><file name="a.iso"><url location="US">https://mirror.example/a.iso</url></file></metalink>'
    expect(parseMetalink(xml)[0].urls).toEqual(['https://mirror.example/a.iso'])
  })
  it('throws for invalid xml', () => {
    expect(() => parseMetalink('not xml <<')).toThrow()
  })
})
