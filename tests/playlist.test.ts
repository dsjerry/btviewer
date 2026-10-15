import { describe, expect, it } from 'vitest'
import { buildPlaylist } from '../src/services/playlist'
import type { PlaylistEntry, TorrentFileInfo, TorrentStatus } from '../src/types'

const file = (name: string, type: TorrentFileInfo['type'] = 'video'): TorrentFileInfo => ({ name, path: `/dl/${name}`, size: 1000, completed: 1000, type })
const torrent = (infoHash: string, name: string, files: TorrentFileInfo[]): TorrentStatus => ({
  infoHash, name, magnetURI: `magnet:?xt=urn:btih:${infoHash}`, progress: 1, downloadSpeed: 0, uploadSpeed: 0,
  downloaded: 1000, totalSize: 1000, numPeers: 0, timeRemaining: 0, status: 'seeding', files, uploaded: 0, saveDir: '/dl'
})
const entry = (infoHash: string, name: string): PlaylistEntry => ({ infoHash, file: file(name), torrentName: name })

describe('buildPlaylist', () => {
  const season1 = torrent('hash1', 'Show.S01.1080p', [file('Show.S01E02.1080p.mkv'), file('Show.S01E01.1080p.mkv'), file('Show.S01E01.1080p.srt', 'subtitle')])
  const season2 = torrent('hash2', 'Show.S02.1080p', [file('Show.S02E01.1080p.mkv')])
  const other = torrent('hash3', 'Other.Show.S01.1080p', [file('Other.Show.S01E01.1080p.mkv')])

  it('跨任务聚合同一部剧并按季/集排序，忽略字幕等非媒体文件', () => {
    const list = buildPlaylist([season1, season2, other], entry('hash1', 'Show.S01E02.1080p.mkv'))
    expect(list.map((item) => item.file.name)).toEqual(['Show.S01E01.1080p.mkv', 'Show.S01E02.1080p.mkv', 'Show.S02E01.1080p.mkv'])
    expect(list.map((item) => item.infoHash)).toEqual(['hash1', 'hash1', 'hash2'])
  })

  it('不同剧不会混进同一个播放列表', () => {
    const list = buildPlaylist([season1, season2, other], entry('hash1', 'Show.S01E01.1080p.mkv'))
    expect(list.some((item) => item.infoHash === 'hash3')).toBe(false)
  })

  it('电影（识别不出季集）只列出当前任务的媒体，按名称自然序', () => {
    const movie = torrent('hash4', 'Movie.2014.1080p', [file('Movie.Part10.mkv'), file('Movie.Part2.mkv'), file('cover.jpg', 'other')])
    const list = buildPlaylist([movie, season1], entry('hash4', 'Movie.Part10.mkv'))
    expect(list.map((item) => item.file.name)).toEqual(['Movie.Part2.mkv', 'Movie.Part10.mkv'])
  })

  it('剧集：当前任务已被移除时仍列出同一部剧其余任务里的集', () => {
    const list = buildPlaylist([season1], entry('gone', 'Show.S01E05.1080p.mkv'))
    expect(list.map((item) => item.file.name)).toEqual(['Show.S01E01.1080p.mkv', 'Show.S01E02.1080p.mkv'])
  })

  it('电影：当前任务已被移除时没有可回退的列表', () => {
    const movie = torrent('hash4', 'Movie.2014.1080p', [file('Movie.Part1.mkv')])
    expect(buildPlaylist([movie], entry('gone', 'Movie.Part1.mkv'))).toEqual([])
  })

  it('没有正在播放的文件时返回空', () => {
    expect(buildPlaylist([season1, season2], null)).toEqual([])
  })
})
