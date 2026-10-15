// 播放列表聚合（B4）：同一部剧的集常常分散在多个任务里（一季一个种子），
// 因此这里跨任务把同一部剧的可播文件聚成一个列表，按季/集排序供播放器「上一集/下一集/连播」使用。
import { compareEpisodes, parseEpisode, seriesKey } from './episode'
import type { PlaylistEntry, TorrentStatus } from '../types'

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
const mediaOf = (torrent: TorrentStatus) => torrent.files.filter((file) => file.type === 'video' || file.type === 'audio')

export function buildPlaylist(torrents: TorrentStatus[], current: PlaylistEntry | null): PlaylistEntry[] {
  if (!current) return []
  const key = seriesKey(current.file.name)
  // 识别不出季集（电影、演唱会、单文件资源）时只看当前任务，保持原有行为
  if (!parseEpisode(current.file.name) || !key) {
    const owner = torrents.find((torrent) => torrent.infoHash === current.infoHash)
    if (!owner) return []
    return mediaOf(owner).sort((a, b) => natural(a.name, b.name)).map((file) => ({ infoHash: owner.infoHash, file, torrentName: owner.name }))
  }
  const entries: PlaylistEntry[] = []
  for (const torrent of torrents) {
    for (const file of mediaOf(torrent)) {
      // 同剧但不成集的杂项文件（sample/预告等）用归集键自然排除
      if (seriesKey(file.name) !== key) continue
      entries.push({ infoHash: torrent.infoHash, file, torrentName: torrent.name })
    }
  }
  return entries.sort((a, b) => compareEpisodes(parseEpisode(a.file.name), parseEpisode(b.file.name), a.file.name, b.file.name))
}
