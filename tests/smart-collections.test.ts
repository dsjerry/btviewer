import { describe, expect, it } from 'vitest'
import { hasSmartRule, isSmartCollectionId, matchesSmartCollection, smartCollectionKey } from '../src/services/smart-collections'

const ctx = (overrides: Partial<Parameters<typeof matchesSmartCollection>[1]> = {}) => ({
  watchPercent: 0,
  rating: 0,
  addedAt: 1000,
  now: 2000,
  ...overrides
})

describe('matchesSmartCollection', () => {
  it('未声明的规则不参与过滤（空规则恒真）', () => {
    expect(matchesSmartCollection({}, ctx())).toBe(true)
  })

  it('kind：任务含视频流 → video，纯音频 → audio', () => {
    expect(matchesSmartCollection({ kind: 'video' }, ctx({ kind: 'video' }))).toBe(true)
    expect(matchesSmartCollection({ kind: 'video' }, ctx({ kind: 'audio' }))).toBe(false)
    expect(matchesSmartCollection({ kind: 'audio' }, ctx())).toBe(false)
  })

  it('minRating：评分达到下限才通过', () => {
    expect(matchesSmartCollection({ minRating: 4 }, ctx({ rating: 4 }))).toBe(true)
    expect(matchesSmartCollection({ minRating: 4 }, ctx({ rating: 5 }))).toBe(true)
    expect(matchesSmartCollection({ minRating: 4 }, ctx({ rating: 3 }))).toBe(false)
    expect(matchesSmartCollection({ minRating: 4 }, ctx())).toBe(false)
  })

  it('watchState unfinished：0 < 进度 < 95', () => {
    expect(matchesSmartCollection({ watchState: 'unfinished' }, ctx({ watchPercent: 40 }))).toBe(true)
    expect(matchesSmartCollection({ watchState: 'unfinished' }, ctx({ watchPercent: 0 }))).toBe(false)
    expect(matchesSmartCollection({ watchState: 'unfinished' }, ctx({ watchPercent: 95 }))).toBe(false)
    expect(matchesSmartCollection({ watchState: 'unfinished' }, ctx({ watchPercent: 100 }))).toBe(false)
  })

  it('addedWithinDays：按注入的 now 判定窗口', () => {
    const day = 86400000
    expect(matchesSmartCollection({ addedWithinDays: 7 }, ctx({ addedAt: 2000 - day * 3 }))).toBe(true)
    expect(matchesSmartCollection({ addedWithinDays: 7 }, ctx({ addedAt: 2000 - day * 8 }))).toBe(false)
    expect(matchesSmartCollection({ addedWithinDays: 7 }, ctx({ addedAt: 0 }))).toBe(false)
  })

  it('多规则 AND 语义：任一不满足即排除', () => {
    const rules = { kind: 'video' as const, minRating: 4, watchState: 'unfinished' as const }
    expect(matchesSmartCollection(rules, ctx({ kind: 'video', rating: 5, watchPercent: 50 }))).toBe(true)
    expect(matchesSmartCollection(rules, ctx({ kind: 'video', rating: 5, watchPercent: 100 }))).toBe(false)
    expect(matchesSmartCollection(rules, ctx({ kind: 'audio', rating: 5, watchPercent: 50 }))).toBe(false)
  })
})

describe('ID 约定与规则校验', () => {
  it('smart: 前缀与判定', () => {
    expect(smartCollectionKey('abc')).toBe('smart:abc')
    expect(isSmartCollectionId('smart:abc')).toBe(true)
    expect(isSmartCollectionId('all')).toBe(false)
    expect(isSmartCollectionId('some-uuid')).toBe(false)
  })

  it('hasSmartRule：至少一条规则才允许创建', () => {
    expect(hasSmartRule({})).toBe(false)
    expect(hasSmartRule({ kind: 'video' })).toBe(true)
    expect(hasSmartRule({ minRating: 4 })).toBe(true)
    expect(hasSmartRule({ watchState: 'unfinished' })).toBe(true)
    expect(hasSmartRule({ addedWithinDays: 7 })).toBe(true)
  })
})
