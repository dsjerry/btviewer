import { XMLParser } from 'fast-xml-parser'

// RSS/Atom 解析的纯函数部分：不依赖 electron，便于单元测试
export interface ParsedItem { guid: string; title: string; magnet: string; torrentUrl: string; pubDate?: string }

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const MAGNET_RE = /magnet:\?xt=urn:btih:[a-z\d]{32,40}[^\s"'<>]*/i

// XMLParser 已解码实体；value 可能是字符串、{#text}（带属性节点）或 {href}/{url}（atom link/enclosure）
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    for (const key of ['#text', '@_href', '@_url']) if (typeof record[key] === 'string') return record[key] as string
  }
  return ''
}

export function extractMagnet(source: string): string {
  return source.match(MAGNET_RE)?.[0] ?? ''
}

// RSS 2.0（rss.channel.item）与 Atom（feed.entry）都归一化；同时兜底扫描全文中的磁力链接
export function parseFeedItems(xml: string): ParsedItem[] {
  let doc: Record<string, unknown>
  try { doc = parser.parse(xml) as Record<string, unknown> } catch { return [] }
  const channel = (doc.rss as Record<string, unknown> | undefined)?.channel ?? (doc['rdf:RDF'] as Record<string, unknown> | undefined)?.channel
  let raw: unknown = (doc.feed as Record<string, unknown> | undefined)?.entry ?? (channel as Record<string, unknown> | undefined)?.item ?? []
  if (!Array.isArray(raw)) raw = raw ? [raw] : []
  const items: ParsedItem[] = []
  for (const entry of raw as Array<Record<string, unknown>>) {
    const title = text(entry.title)
    const link = text(entry.link)
    const enclosure = text(entry.enclosure)
    const magnet = link.startsWith('magnet:') ? link : enclosure.startsWith('magnet:') ? enclosure : extractMagnet(`${title} ${text(entry.description)} ${text(entry.summary)} ${JSON.stringify(entry)}`)
    const torrentUrl = /\.torrent(\?|#|$)/i.test(enclosure) ? enclosure : /\.torrent(\?|#|$)/i.test(link) ? link : ''
    const guid = text(entry.guid) || text(entry.id) || link || title
    if (!guid) continue
    items.push({ guid, title, magnet, torrentUrl, pubDate: text(entry.pubDate) || text(entry.updated) || text(entry.published) || undefined })
  }
  return items
}

// 关键词全部命中（不区分大小写）才算匹配；未配置关键词视为全部匹配
export function matchKeywords(title: string, keywords: string[]): boolean {
  const lower = title.toLowerCase()
  return keywords.every((keyword) => lower.includes(keyword.trim().toLowerCase()))
}

// 从标题解析季数：SxxExx / 第x季 / Season x / 2x03
export function parseSeason(title: string): number | null {
  const patterns = [/[Ss](\d{1,2})[\s._]*[Ee]\d{1,3}/, /第\s*(\d{1,2})\s*季/, /Season\s*(\d{1,2})/i, /\b(\d{1,2})x\d{1,3}\b/]
  for (const pattern of patterns) {
    const match = title.match(pattern)
    if (match) { const season = Number(match[1]); if (season >= 1 && season <= 99) return season }
  }
  return null
}
