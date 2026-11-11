import { describe, expect, it } from 'vitest'
import { hasMediaCollectionItem, isMediaCollectionItem, mediaCollectionItemKey, updateMediaCollectionItems } from '../src/services/media-collections'
import type { MediaCollection } from '../src/types'

const collections: MediaCollection[] = [
  { id: 'series', name: 'Series', createdAt: 1, items: [{ type: 'task', id: 'hash-a' }] },
  { id: 'favorites', name: 'Favorites', createdAt: 2, items: [{ type: 'local', id: '/media/one.mp4' }] },
  { id: 'empty', name: 'Empty', createdAt: 3, items: [] }
]

describe('media collection membership', () => {
  it('adds multiple task and local items without removing other collection memberships', () => {
    const items = [{ type: 'task', id: 'hash-a' }, { type: 'local', id: '/media/two.mp4' }] as const
    const next = updateMediaCollectionItems(collections, 'favorites', [...items], 'add')
    expect(next[0].items).toEqual(collections[0].items)
    expect(next[1].items).toContainEqual(items[0])
    expect(next[1].items).toContainEqual(items[1])
    expect(hasMediaCollectionItem(next[1], items[0])).toBe(true)
  })

  it('removes selected items only from the chosen collection', () => {
    const next = updateMediaCollectionItems(collections, 'favorites', [{ type: 'local', id: '/media/one.mp4' }], 'remove')
    expect(next[0].items).toEqual(collections[0].items)
    expect(next[1].items).toEqual([])
  })

  it('keeps task and local identities distinct and rejects malformed entries', () => {
    expect(hasMediaCollectionItem(collections[0], { type: 'local', id: 'hash-a' })).toBe(false)
    expect(isMediaCollectionItem({ type: 'task', id: 'hash-a' })).toBe(true)
    expect(isMediaCollectionItem({ type: 'unknown', id: 'hash-a' })).toBe(false)
    expect(isMediaCollectionItem({ type: 'task', id: '' })).toBe(false)
    expect(mediaCollectionItemKey({ type: 'task', id: '/media/one.mp4' })).not.toBe(mediaCollectionItemKey({ type: 'local', id: '/media/one.mp4' }))
  })
})
