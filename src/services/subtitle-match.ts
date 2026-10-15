// 字幕匹配（B5）：给「当前播放的视频」挑出该任务里真正属于它的字幕，并给出语言标签。
// 纯函数：主进程不做匹配，渲染层的自动挂载与字幕面板都用同一套排序。
import { seriesKey } from './episode'

export interface SubtitleCandidate {
  name: string
  path: string
  // 语言标签（中文/繁体/英文/…）；识别不出时为空串
  language: string
  score: number
}

const LANGUAGE_RULES: Array<{ re: RegExp; label: string }> = [
  { re: /\b(chi&eng|chs&eng|cht&eng)\b|双语|中英|简英/, label: '双语' },
  { re: /繁体|繁中|\b(cht|tc|zh-tw|zh-hk|zh-hant|big5)\b/, label: '繁体' },
  { re: /简体|简中|中文|\b(chs|sc|zh-cn|zh-hans|chi|zho|zh)\b/, label: '中文' },
  { re: /粤语|粤|\byue\b/, label: '粤语' },
  { re: /英语|英文|\b(eng|english|en)\b/, label: '英文' },
  { re: /日语|日文|\b(jpn|jp|ja)\b/, label: '日语' },
  { re: /韩语|韩文|\b(kor|kr|ko)\b/, label: '韩语' },
  { re: /西班牙|\b(spa|esp|es)\b/, label: '西班牙语' },
  { re: /法语|法国|\b(fra|fre|fr)\b/, label: '法语' },
  { re: /德语|德国|\b(ger|deu|de)\b/, label: '德语' },
  { re: /俄语|\b(rus|ru)\b/, label: '俄语' }
]
// 中文字幕优先（这类应用的绝大多数使用场景），仅用于同分档内排序
const PREFERRED = ['中文', '繁体', '双语']

function stripExtension(name: string) {
  const index = name.lastIndexOf('.')
  return index > 0 ? name.slice(0, index) : name
}

export function subtitleLanguage(name: string): string {
  const base = stripExtension(name)
  for (const rule of LANGUAGE_RULES) if (rule.re.test(base)) return rule.label
  return ''
}

function episodeToken(name: string): string {
  const match = /(?:^|[^a-z0-9])s(\d{1,2})[\s._-]*e(\d{1,3})(?![0-9])/i.exec(name)
  if (match) return `s${Number(match[1])}e${Number(match[2])}`
  const alt = /(?:^|[^a-z0-9])(\d{1,2})x(\d{1,3})(?![0-9])/i.exec(name)
  if (alt) return `s${Number(alt[1])}e${Number(alt[2])}`
  return ''
}

// 归一化：去掉扩展名、语言标记与分隔符，便于比较「同名」字幕
function normalize(name: string) {
  let base = stripExtension(name).toLowerCase()
  for (const rule of LANGUAGE_RULES) base = base.replace(new RegExp(rule.re.source, 'gi'), ' ')
  return base.replace(/[\s._\-[\]]+/g, ' ').trim()
}

// 匹配分档：同名（含仅差语言标记）> 同名带额外后缀 > 同剧同集（命名风格不同）> 整季字幕包；其余不选
export function subtitleMatchScore(videoName: string, subtitleName: string): number {
  const video = normalize(videoName)
  const subtitle = normalize(subtitleName)
  if (!video || !subtitle) return 0
  if (video === subtitle) return 100
  // 只允许「字幕名 = 视频名 + 额外标记」，反过来（整季包 'show s01' 是 'show s01e02' 的前缀）不算同集
  if (subtitle.startsWith(video)) return 90
  const videoEpisode = episodeToken(videoName)
  const subtitleEpisode = episodeToken(subtitleName)
  if (videoEpisode && subtitleEpisode) {
    // 集号相同还必须是同一部剧，否则会把别的剧的同集字幕挂上来
    return videoEpisode === subtitleEpisode && seriesKey(videoName) === seriesKey(subtitleName) ? 80 : 0
  }
  // 字幕没有集号：同一部剧的整季包，低分候选（面板里仍可手动选）
  if (videoEpisode && !subtitleEpisode && seriesKey(videoName) === seriesKey(subtitleName)) return 60
  return 0
}

// 排序：得分高者优先，同档内中文优先，再按名称
export function rankSubtitles(videoName: string, files: Array<{ name: string; path: string }>): SubtitleCandidate[] {
  return files
    .map((file) => ({ name: file.name, path: file.path, language: subtitleLanguage(file.name), score: subtitleMatchScore(videoName, file.name) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const preferred = (item: SubtitleCandidate) => (PREFERRED.includes(item.language) ? 1 : 0)
      if (preferred(b) !== preferred(a)) return preferred(b) - preferred(a)
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    })
}

// 自动挂载的首选：必须至少是「整季包」级别（score ≥ 60），否则宁可不出字幕
export function pickAutoSubtitle(candidates: SubtitleCandidate[]): SubtitleCandidate | null {
  const best = candidates[0]
  return best && best.score >= 60 ? best : null
}
