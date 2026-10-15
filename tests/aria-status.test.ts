import { describe, expect, it } from 'vitest'
import { computeProgress, computeTimeRemaining, isFinished, mapAriaState, retryDelayMs, selectFileIndexes } from '../electron/aria-status'

describe('mapAriaState', () => {
  it('错误优先', () => {
    expect(mapAriaState({ status: 'error', isMetadata: true })).toBe('error')
  })

  it('metadata 父任务算解析中', () => {
    expect(mapAriaState({ status: 'active', isMetadata: true })).toBe('parsing')
  })

  it('暂停优先于做种', () => {
    expect(mapAriaState({ status: 'paused', seeder: 'true', isMetadata: false })).toBe('paused')
  })

  it('做种中（aria2 仍是 active）算已完成', () => {
    expect(mapAriaState({ status: 'active', seeder: 'true', isMetadata: false })).toBe('seeding')
    expect(mapAriaState({ status: 'complete', isMetadata: false })).toBe('seeding')
  })

  it('active 且未做种算下载中，其余（waiting 等）算连接中', () => {
    expect(mapAriaState({ status: 'active', seeder: 'false', isMetadata: false })).toBe('downloading')
    expect(mapAriaState({ status: 'waiting', isMetadata: false })).toBe('connecting')
  })
})

describe('isFinished', () => {
  it('下满或超过总长度算完成', () => {
    expect(isFinished(100, 100)).toBe(true)
    expect(isFinished(120, 100)).toBe(true)
  })

  it('总长度未知或未下满不算完成', () => {
    expect(isFinished(0, 0)).toBe(false)
    expect(isFinished(99, 100)).toBe(false)
  })
})

describe('computeProgress', () => {
  it('归一化到 0-1，并在超出时收敛', () => {
    expect(computeProgress(50, 100)).toBe(0.5)
    expect(computeProgress(150, 100)).toBe(1)
    expect(computeProgress(0, 0)).toBe(0)
    expect(computeProgress(-5, 100)).toBe(0)
  })
})

describe('computeTimeRemaining', () => {
  it('按速度换算剩余毫秒', () => {
    expect(computeTimeRemaining(0, 1000, 100)).toBe(10000)
    expect(computeTimeRemaining(500, 1000, 100)).toBe(5000)
  })

  it('速度为 0 或已下满时返回 0', () => {
    expect(computeTimeRemaining(0, 1000, 0)).toBe(0)
    expect(computeTimeRemaining(1000, 1000, 100)).toBe(0)
    expect(computeTimeRemaining(2000, 1000, 100)).toBe(0)
  })
})

describe('retryDelayMs', () => {
  it('5 秒起步指数退避，封顶 2 分钟', () => {
    expect(retryDelayMs(1, 3)).toBe(5000)
    expect(retryDelayMs(2, 3)).toBe(10000)
    expect(retryDelayMs(3, 3)).toBe(20000)
    expect(retryDelayMs(9, 10)).toBe(120000)
  })

  it('超过上限或非法次数返回 null', () => {
    expect(retryDelayMs(4, 3)).toBeNull()
    expect(retryDelayMs(0, 3)).toBeNull()
    expect(retryDelayMs(Number.NaN, 3)).toBeNull()
  })
})

describe('selectFileIndexes', () => {
  const files = [
    { index: '1', path: '/dl/Show/ep1.mkv' },
    { index: '2', path: '/dl/Show/ep2.mkv' },
    { index: '3', path: '/dl/Show/readme.txt' }
  ]

  it('不传文件列表表示全选', () => {
    expect(selectFileIndexes(files)).toEqual(['1', '2', '3'])
    expect(selectFileIndexes(files, [])).toEqual(['1', '2', '3'])
  })

  it('按完整路径或文件名匹配', () => {
    expect(selectFileIndexes(files, ['/dl/Show/ep2.mkv'])).toEqual(['2'])
    expect(selectFileIndexes(files, ['ep1.mkv', 'readme.txt'])).toEqual(['1', '3'])
  })

  it('一个都没匹配上时返回空数组（调用方据此报错，避免误下全量）', () => {
    expect(selectFileIndexes(files, ['missing.mkv'])).toEqual([])
  })
})
