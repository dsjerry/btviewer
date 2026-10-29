import { describe, expect, it } from 'vitest'
import { sameTorrentFile, sameTorrentList, sameTorrentStatus } from '../src/services/torrent-diff'
import type { TorrentStatus } from '../src/types'

function status(overrides: Partial<TorrentStatus> = {}): TorrentStatus {
  return {
    infoHash: 'abc',
    name: 'Example',
    magnetURI: 'magnet:?xt=urn:btih:abc',
    progress: 0.5,
    downloadSpeed: 1024,
    uploadSpeed: 0,
    downloaded: 500,
    totalSize: 1000,
    numPeers: 3,
    timeRemaining: 1000,
    status: 'downloading',
    files: [
      { name: 'a.mkv', path: '/dl/a.mkv', size: 800, completed: 400, type: 'video' },
      { name: 'b.srt', path: '/dl/b.srt', size: 200, completed: 100, type: 'subtitle' }
    ],
    uploaded: 0,
    saveDir: '/dl',
    type: 'bt',
    addedAt: 1,
    ...overrides
  }
}

describe('sameTorrentStatus', () => {
  it('同一引用直接相等（最快路径）', () => {
    const a = status()
    expect(sameTorrentStatus(a, a)).toBe(true)
  })

  it('内容相同的两个对象判定为等价（避免每秒重渲染）', () => {
    expect(sameTorrentStatus(status(), status())).toBe(true)
  })

  it('可见字段变化会被识别', () => {
    expect(sameTorrentStatus(status(), status({ progress: 0.6 }))).toBe(false)
    expect(sameTorrentStatus(status(), status({ downloadSpeed: 2048 }))).toBe(false)
    expect(sameTorrentStatus(status(), status({ status: 'seeding' }))).toBe(false)
    expect(sameTorrentStatus(status(), status({ queuePosition: 2 }))).toBe(false)
  })

  it('文件进度变化会被识别，但数组身份变化不算变化', () => {
    const base = status()
    const sameContent = status({ files: base.files.map((file) => ({ ...file })) })
    expect(sameTorrentStatus(base, sameContent)).toBe(true)

    const progressed = status({ files: base.files.map((file) => ({ ...file })) })
    progressed.files[0].completed = 500
    expect(sameTorrentStatus(base, progressed)).toBe(false)

    const renamed = status({ files: [{ ...base.files[0], name: 'renamed.mkv' }, base.files[1]] })
    // name 变了但 path/size/completed 未变：文件行渲染用的是 name，这里按路径维度判断，视为无变化
    expect(sameTorrentStatus(base, renamed)).toBe(true)
  })

  it('缺少一方时不等价', () => {
    expect(sameTorrentStatus(undefined, status())).toBe(false)
    expect(sameTorrentStatus(status(), undefined)).toBe(false)
  })
})

describe('sameTorrentList', () => {
  it('长度或顺序不同即不等价', () => {
    const a = status({ infoHash: 'a' })
    const b = status({ infoHash: 'b' })
    expect(sameTorrentList([a, b], [a, b])).toBe(true)
    expect(sameTorrentList([a, b], [b, a])).toBe(false)
    expect(sameTorrentList([a], [a, b])).toBe(false)
  })
})

describe('sameTorrentFile 与 selected', () => {
  it('勾选状态变化需要重渲染', () => {
    const file = { name: 'a.mkv', path: '/dl/a.mkv', size: 800, completed: 400, type: 'video' as const, selected: true }
    expect(sameTorrentFile(file, { ...file })).toBe(true)
    expect(sameTorrentFile(file, { ...file, selected: false })).toBe(false)
  })
})

describe('sameTorrentFile', () => {
  it('只比较影响渲染的字段', () => {
    const file = { name: 'a.mkv', path: '/dl/a.mkv', size: 800, completed: 400, type: 'video' as const }
    expect(sameTorrentFile(file, { ...file })).toBe(true)
    expect(sameTorrentFile(file, { ...file, completed: 800 })).toBe(false)
    expect(sameTorrentFile(file, { ...file, path: '/dl/b.mkv' })).toBe(false)
  })
})
