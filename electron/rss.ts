import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { app } from 'electron'
import { torrentEngine } from './torrent-engine'
import { logger } from './logger'
import { matchKeywords, parseFeedItems, parseSeason, type ParsedItem } from './rss-parse'

// 订阅源：轮询 RSS → 关键词匹配 → 自动加入下载；按季归类与完成通知由调用方（main.ts）联动
export interface FeedItem { guid: string; title: string; magnet: string; torrentUrl: string; pubDate?: string; downloaded?: boolean }

export interface Feed {
  id: string
  name: string
  url: string
  keywords: string[]
  autoDownload: boolean
  groupBySeason: boolean
  enabled: boolean
  lastCheckedAt?: number
  lastError?: string
  items: FeedItem[]
  seenGuids: string[]
}

const MAX_ITEMS = 50
const MAX_SEEN = 500

const feedsFile = () => join(app.getPath('userData'), 'feeds.json')
let cache: Feed[] | null = null

function loadFeeds(): Feed[] {
  if (cache) return cache
  try { cache = JSON.parse(readFileSync(feedsFile(), 'utf8')) as Feed[] } catch { cache = [] }
  if (!Array.isArray(cache)) cache = []
  return cache
}

function persist() {
  try { writeFileSync(feedsFile(), JSON.stringify(loadFeeds(), null, 2)) } catch (error) { logger.error('feeds', `persist failed: ${error instanceof Error ? error.message : String(error)}`) }
}

export function getFeeds(): Feed[] { return loadFeeds() }

export function addFeed(input: { name?: string; url?: string; keywords?: string[]; autoDownload?: boolean; groupBySeason?: boolean }): Feed {
  const url = (input.url || '').trim()
  if (!/^https?:\/\//i.test(url)) throw new Error('订阅地址必须是 http(s) 链接')
  const feed: Feed = {
    id: randomBytes(8).toString('hex'),
    name: (input.name || '').trim() || '未命名订阅',
    url,
    keywords: (input.keywords || []).map((item) => item.trim()).filter(Boolean),
    autoDownload: input.autoDownload !== false,
    groupBySeason: input.groupBySeason === true,
    enabled: true,
    items: [],
    seenGuids: []
  }
  loadFeeds().push(feed)
  persist()
  return feed
}

export function removeFeed(id: string) {
  const feeds = loadFeeds()
  const index = feeds.findIndex((feed) => feed.id === id)
  if (index >= 0) { feeds.splice(index, 1); persist() }
}

export function updateFeed(id: string, patch: Partial<Pick<Feed, 'name' | 'keywords' | 'autoDownload' | 'groupBySeason' | 'enabled' | 'url'>>) {
  const feed = loadFeeds().find((item) => item.id === id)
  if (!feed) throw new Error('订阅不存在')
  if (patch.url !== undefined) { if (!/^https?:\/\//i.test(patch.url.trim())) throw new Error('订阅地址必须是 http(s) 链接'); feed.url = patch.url.trim() }
  if (patch.name !== undefined) feed.name = patch.name.trim() || feed.name
  if (patch.keywords !== undefined) feed.keywords = patch.keywords.map((item) => item.trim()).filter(Boolean)
  if (patch.autoDownload !== undefined) feed.autoDownload = patch.autoDownload
  if (patch.groupBySeason !== undefined) feed.groupBySeason = patch.groupBySeason
  if (patch.enabled !== undefined) feed.enabled = patch.enabled
  persist()
  return feed
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { 'user-agent': 'BTViewer/1.0' }, signal: AbortSignal.timeout(20000) })
  if (!response.ok) throw new Error(`RSS 服务器返回 ${response.status}`)
  return response.text()
}

// 加入下载任务；按季归类时目录为 下载目录/订阅名/Sxx（aria2 的 dir 选项直接支持）
async function downloadToTask(feed: Feed, item: ParsedItem) {
  let dir: string | undefined
  if (feed.groupBySeason) {
    const season = parseSeason(item.title)
    dir = season ? join(torrentEngine.effectiveDownloadDir(), feed.name, `S${String(season).padStart(2, '0')}`) : join(torrentEngine.effectiveDownloadDir(), feed.name)
    mkdirSync(dir, { recursive: true })
  }
  if (item.magnet) { await torrentEngine.addTorrent(item.magnet, undefined, { wait: false, dir }); return }
  if (!item.torrentUrl) throw new Error('条目没有磁力或种子链接')
  const response = await fetch(item.torrentUrl, { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`种子文件下载失败（${response.status}）`)
  const tmp = join(tmpdir(), `btviewer-${randomBytes(6).toString('hex')}.torrent`)
  writeFileSync(tmp, Buffer.from(await response.arrayBuffer()))
  try { await torrentEngine.addTorrent(tmp, undefined, { wait: false, dir }) } finally { rmSync(tmp, { force: true }) }
}

export async function checkFeed(feedId: string): Promise<Feed> {
  const feed = loadFeeds().find((item) => item.id === feedId)
  if (!feed) throw new Error('订阅不存在')
  feed.lastCheckedAt = Date.now()
  try {
    const items = parseFeedItems(await fetchText(feed.url))
    feed.lastError = undefined
    const seen = new Set(feed.seenGuids)
    for (const item of items) {
      if (!item.guid || seen.has(item.guid)) continue
      seen.add(item.guid)
      const record: FeedItem = { ...item }
      if (feed.enabled && feed.autoDownload && matchKeywords(item.title, feed.keywords)) {
        try {
          await downloadToTask(feed, item)
          record.downloaded = true
          logger.info('feeds', `auto-download: ${item.title}`)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          feed.lastError = `「${item.title}」自动下载失败：${message}`
          logger.error('feeds', feed.lastError)
        }
      }
      feed.items.unshift(record)
    }
    feed.items = feed.items.slice(0, MAX_ITEMS)
    feed.seenGuids = [...seen].slice(-MAX_SEEN)
  } catch (error) {
    feed.lastError = error instanceof Error ? error.message : String(error)
  }
  persist()
  return feed
}

export async function checkAllFeeds(): Promise<Feed[]> {
  for (const feed of [...loadFeeds()]) {
    if (!feed.enabled) continue
    try { await checkFeed(feed.id) } catch { /* checkFeed 内部已兜底记录错误 */ }
  }
  return getFeeds()
}

export async function downloadFeedItem(feedId: string, guid: string) {
  const feed = loadFeeds().find((item) => item.id === feedId)
  if (!feed) throw new Error('订阅不存在')
  const item = feed.items.find((entry) => entry.guid === guid)
  if (!item) throw new Error('订阅条目不存在')
  await downloadToTask(feed, item)
  item.downloaded = true
  persist()
}

let timer: NodeJS.Timeout | null = null
let checking = false

async function checkAllSerial() {
  if (checking) return
  checking = true
  try { await checkAllFeeds() } finally { checking = false }
}

// 轮询间隔可由环境变量覆盖（分钟）；启动后稍等 aria2 就绪再做首轮检查
export function startPolling() {
  if (timer) return
  const minutes = Number(process.env.RSS_POLL_MINUTES) || 15
  timer = setInterval(() => void checkAllSerial(), Math.max(1, minutes) * 60 * 1000)
  setTimeout(() => void checkAllSerial(), 8000)
}

export function stopPolling() {
  if (timer) { clearInterval(timer); timer = null }
}
