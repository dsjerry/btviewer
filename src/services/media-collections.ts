import type { MediaCollection, MediaCollectionItem } from '../types'

export function isMediaCollectionItem(value: unknown): value is MediaCollectionItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<MediaCollectionItem>
  return (item.type === 'task' || item.type === 'local') && typeof item.id === 'string' && item.id.length > 0
}

export function mediaCollectionItemKey(item: MediaCollectionItem): string {
  return `${item.type}:${item.id}`
}

export function updateMediaCollectionItems(collections: MediaCollection[], collectionId: string, items: MediaCollectionItem[], action: 'add' | 'remove'): MediaCollection[] {
  const keys = new Set(items.filter(isMediaCollectionItem).map(mediaCollectionItemKey))
  return collections.map((collection) => {
    if (collection.id !== collectionId) return collection
    const members = action === 'add'
      ? new Map([...collection.items, ...items.filter(isMediaCollectionItem)].map((item) => [mediaCollectionItemKey(item), item]))
      : new Map(collection.items.filter((item) => !keys.has(mediaCollectionItemKey(item))).map((item) => [mediaCollectionItemKey(item), item]))
    return { ...collection, items: [...members.values()] }
  })
}

export function hasMediaCollectionItem(collection: MediaCollection, item: MediaCollectionItem): boolean {
  return collection.items.some((entry) => entry.type === item.type && entry.id === item.id)
}
