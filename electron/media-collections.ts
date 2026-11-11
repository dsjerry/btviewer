import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { MediaCollection, MediaCollectionItem } from '../src/types'
import { isMediaCollectionItem, updateMediaCollectionItems } from '../src/services/media-collections'
import { writeJsonAtomic } from './storage'

const collectionsFile = () => join(app.getPath('userData'), 'media-collections.json')
let cache: MediaCollection[] | null = null

function loadAll(): MediaCollection[] {
  if (cache) return cache
  try {
    const parsed = JSON.parse(readFileSync(collectionsFile(), 'utf8')) as unknown
    cache = Array.isArray(parsed) ? parsed.flatMap((value): MediaCollection[] => {
      if (!value || typeof value !== 'object') return []
      const candidate = value as Partial<MediaCollection>
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.createdAt !== 'number') return []
      const items = Array.isArray(candidate.items) ? candidate.items.filter(isMediaCollectionItem) : []
      return [{ id: candidate.id, name: candidate.name, createdAt: candidate.createdAt, items }]
    }) : []
  } catch { cache = [] }
  return cache
}

function persist(collections: MediaCollection[]) {
  cache = collections
  writeJsonAtomic(collectionsFile(), collections, 2)
}

function collectionName(name: string): string {
  const normalized = name.trim()
  if (!normalized) throw new Error('合集名称不能为空')
  if (normalized.length > 80) throw new Error('合集名称不能超过 80 个字符')
  return normalized
}

export function listMediaCollections(): MediaCollection[] {
  return loadAll().slice().sort((a, b) => a.createdAt - b.createdAt)
}

export function createMediaCollection(name: string): MediaCollection[] {
  const collection: MediaCollection = { id: randomUUID(), name: collectionName(name), createdAt: Date.now(), items: [] }
  persist([...loadAll(), collection])
  return listMediaCollections()
}

export function renameMediaCollection(id: string, name: string): MediaCollection[] {
  const normalized = collectionName(name)
  const collections = loadAll()
  if (!collections.some((collection) => collection.id === id)) throw new Error('合集不存在')
  persist(collections.map((collection) => collection.id === id ? { ...collection, name: normalized } : collection))
  return listMediaCollections()
}

export function removeMediaCollection(id: string): MediaCollection[] {
  persist(loadAll().filter((collection) => collection.id !== id))
  return listMediaCollections()
}

export function updateMediaCollectionMembership(collectionId: string, items: MediaCollectionItem[], action: 'add' | 'remove'): MediaCollection[] {
  const collections = loadAll()
  if (!collections.some((collection) => collection.id === collectionId)) throw new Error('合集不存在')
  if (!Array.isArray(items) || !items.length || items.some((item) => !isMediaCollectionItem(item))) throw new Error('媒体库条目无效')
  persist(updateMediaCollectionItems(collections, collectionId, items, action))
  return listMediaCollections()
}
