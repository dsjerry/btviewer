// 媒体评分：5 星制，键沿用合集的 mediaCollectionItemKey（task:${hash} / local:${path}），
// 任务重加 / 本地引用不变键，评分跟随条目而不是任务实例。
// 存储：userData/ratings.json，变更返回完整 Record（沿 media-collections 模式）。
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { RatingEntry } from '../src/types'
import { writeJsonAtomic } from './storage'

const ratingsFile = () => join(app.getPath('userData'), 'ratings.json')
let cache: Record<string, RatingEntry> | null = null

function loadAll(): Record<string, RatingEntry> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(ratingsFile(), 'utf8')) as unknown
    const out: Record<string, RatingEntry> = {}
    if (parsed && typeof parsed === 'object') {
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (!key) continue
        const entry = value as Partial<RatingEntry> | undefined
        if (entry && typeof entry.stars === 'number' && Number.isInteger(entry.stars) && entry.stars >= 1 && entry.stars <= 5 && typeof entry.updatedAt === 'number') {
          out[key] = { stars: entry.stars, updatedAt: entry.updatedAt }
        }
      }
    }
    cache = out
  } catch { cache = {} }
  return cache
}

function persist(ratings: Record<string, RatingEntry>) {
  cache = ratings
  writeJsonAtomic(ratingsFile(), ratings, 2)
}

export function listRatings(): Record<string, RatingEntry> {
  return { ...loadAll() }
}

export function setRating(key: string, stars: number): Record<string, RatingEntry> {
  const normalized = typeof key === 'string' ? key.trim() : ''
  if (!normalized) throw new Error('评分键无效')
  if (!Number.isInteger(stars) || stars < 0 || stars > 5) throw new Error('评分无效')
  const ratings = { ...loadAll() }
  if (stars === 0) delete ratings[normalized]
  else ratings[normalized] = { stars, updatedAt: Date.now() }
  persist(ratings)
  return listRatings()
}
