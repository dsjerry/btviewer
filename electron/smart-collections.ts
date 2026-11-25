// 智能合集存储：规则驱动的动态合集定义（匹配逻辑在 src/services/smart-collections.ts，
// 由库视图按当前库内容实时求值，这里只负责定义的持久化）。
// 存储：userData/smart-collections.json，变更返回完整列表（沿 media-collections 模式）。
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { SmartCollection, SmartCollectionRules } from '../src/types'
import { hasSmartRule } from '../src/services/smart-collections'
import { writeJsonAtomic } from './storage'

const file = () => join(app.getPath('userData'), 'smart-collections.json')
let cache: SmartCollection[] | null = null

function isRules(value: unknown): value is SmartCollectionRules {
  if (!value || typeof value !== 'object') return false
  const rules = value as Partial<SmartCollectionRules>
  if (rules.kind !== undefined && rules.kind !== 'video' && rules.kind !== 'audio') return false
  if (rules.watchState !== undefined && rules.watchState !== 'unfinished') return false
  if (rules.minRating !== undefined && (typeof rules.minRating !== 'number' || rules.minRating < 1 || rules.minRating > 5)) return false
  if (rules.addedWithinDays !== undefined && (typeof rules.addedWithinDays !== 'number' || rules.addedWithinDays <= 0)) return false
  if (rules.personId !== undefined && (typeof rules.personId !== 'string' || !rules.personId)) return false
  return true
}

function loadAll(): SmartCollection[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    cache = Array.isArray(parsed) ? parsed.flatMap((value): SmartCollection[] => {
      if (!value || typeof value !== 'object') return []
      const candidate = value as Partial<SmartCollection>
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.createdAt !== 'number') return []
      if (!isRules(candidate.rules) || !hasSmartRule(candidate.rules)) return []
      return [{ id: candidate.id, name: candidate.name, createdAt: candidate.createdAt, rules: candidate.rules }]
    }) : []
  } catch { cache = [] }
  return cache
}

function persist(collections: SmartCollection[]) {
  cache = collections
  writeJsonAtomic(file(), collections, 2)
}

function nameOf(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('智能合集名称不能为空')
  if (normalized.length > 80) throw new Error('智能合集名称不能超过 80 个字符')
  return normalized
}

function rulesOf(rules: SmartCollectionRules): SmartCollectionRules {
  if (!isRules(rules) || !hasSmartRule(rules)) throw new Error('智能合集至少需要一条规则')
  return rules
}

export function listSmartCollections(): SmartCollection[] {
  return loadAll().slice().sort((a, b) => a.createdAt - b.createdAt)
}

export function createSmartCollection(name: string, rules: SmartCollectionRules): SmartCollection[] {
  persist([...loadAll(), { id: randomUUID(), name: nameOf(name), createdAt: Date.now(), rules: rulesOf(rules) }])
  return listSmartCollections()
}

export function renameSmartCollection(id: string, name: string): SmartCollection[] {
  const normalized = nameOf(name)
  const collections = loadAll()
  if (!collections.some((collection) => collection.id === id)) throw new Error('智能合集不存在')
  persist(collections.map((collection) => collection.id === id ? { ...collection, name: normalized } : collection))
  return listSmartCollections()
}

export function removeSmartCollection(id: string): SmartCollection[] {
  persist(loadAll().filter((collection) => collection.id !== id))
  return listSmartCollections()
}
