import { createHash } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getFileType, infoHashFromMagnet, isUnderRoot, torrentInfoHash, trackerList } from '../electron/torrent-engine'

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
