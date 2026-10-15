// 剧集识别（B4）：从文件名解析季/集，并给出「同一部剧」的归集键，用于跨任务连播与归类。
// 纯函数，主进程与渲染层共用（渲染层算播放列表，主进程按季归档 RSS 下载目录）。
export interface EpisodeTag {
  season: number
  episode: number
}

// 常见命名：S01E02 / 1x02 / 第1季第2集 / 第2集 / EP02 / E02（最后一个必须有分隔符，避免误伤 1080p 里的 e）
const SEASON_EPISODE: Array<{ re: RegExp; season: (m: RegExpExecArray) => number; episode: (m: RegExpExecArray) => number }> = [
  { re: /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?![0-9])/i, season: (m) => Number(m[1]), episode: (m) => Number(m[2]) },
  { re: /(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?![0-9])/i, season: (m) => Number(m[1]), episode: (m) => Number(m[2]) },
  { re: /第\s*(\d{1,3})\s*季[\s._-]*第\s*(\d{1,3})\s*[集话話]/, season: (m) => Number(m[1]), episode: (m) => Number(m[2]) }
]
const EPISODE_ONLY: RegExp[] = [
  /第\s*(\d{1,3})\s*[集话話]/,
  /(?:^|[^a-z0-9])(?:ep|e)[\s._-]?(\d{1,3})(?![0-9])/i
]
// 归集键要切掉的位置：季集标记、季标记、年份（各版本压制组写法不一，切得越早越稳）
const SERIES_CUT = /(?:^|[^a-z0-9])(?:s\d{1,2}(?:[\s._-]*e\d{1,3})?|\d{1,2}x\d{1,3}|第\s*\d{1,3}\s*[季集话話]|ep?[\s._-]?\d{1,3})(?![0-9])/i
// 压制/编码/音轨噪声：这些标记在不同版本间不一致，归集时必须忽略（否则同剧不同版本归不到一起）
const NOISE_TOKENS = /\b(2160p|1080[pi]|720p|576p|480p|4k|uhd|hdr10\+?|hdr|sdr|10bit|8bit|bluray|blu-ray|bdrip|brrip|web-dl|webrip|web-rip|hdtv|hdrip|dvdrip|remux|proper|repack|extended|imax|x264|x265|h\.?264|h\.?265|hevc|avc|av1|vp9|xvid|divx|aac|ac3|eac3|ddp|dts|truehd|atmos|flac|mp3|opus|vorbis|\d\.\dch?|\d+ch)\b/gi
const QUALITY_MARKER = /(2160p|1080[pi]|720p|480p|4k|uhd|hdr|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdtv|hdrip|dvdrip|remux|x26[45]|h\.?26[45]|hevc|avc|av1)/i

export function parseEpisode(name: string): EpisodeTag | null {
  const base = stripExtension(name)
  for (const pattern of SEASON_EPISODE) {
    const match = pattern.re.exec(base)
    if (match) return { season: pattern.season(match), episode: pattern.episode(match) }
  }
  for (const re of EPISODE_ONLY) {
    const match = re.exec(base)
    if (match) return { season: 1, episode: Number(match[1]) }
  }
  return null
}

function stripExtension(name: string) {
  const lower = name.toLowerCase()
  const index = lower.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

// 同一部剧的归集键：切掉季集与年份，再去掉压制/编码噪声后归一化（小写、分隔符统一为空格）
export function seriesKey(name: string): string {
  const base = stripExtension(name)
  const cut = SERIES_CUT.exec(base)
  let head = cut && cut.index >= 0 ? base.slice(0, cut.index) : base
  // 只有确认是「带压制标记」的命名，才敢把结尾的 -GROUP 当噪声一起切掉
  if (QUALITY_MARKER.test(head)) head = head.replace(/-\s*[A-Za-z0-9]{2,}$/, '')
  const cleaned = normalize(head.replace(NOISE_TOKENS, ' '))
  // 组名/标记占满整个文件名时清理结果会为空，退化为只做分隔符归一化
  return cleaned || normalize(head)
}

function normalize(value: string) {
  return value
    .replace(/[\s._\-[\]()]+/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function episodeLabel(tag: EpisodeTag | null): string {
  if (!tag) return ''
  const season = String(tag.season).padStart(2, '0')
  const episode = String(tag.episode).padStart(2, '0')
  return `S${season}E${episode}`
}

// 排序：先季后集；没有季集信息的排在后面，最后按名称自然序兜底
export function compareEpisodes(a: EpisodeTag | null, b: EpisodeTag | null, fallbackA = '', fallbackB = ''): number {
  if (a && b) {
    if (a.season !== b.season) return a.season - b.season
    if (a.episode !== b.episode) return a.episode - b.episode
  } else if (a) return -1
  else if (b) return 1
  return fallbackA.localeCompare(fallbackB, undefined, { numeric: true, sensitivity: 'base' })
}
