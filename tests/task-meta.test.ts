import { describe, expect, it } from 'vitest'
import { formatSize, STATUS_LABELS, taskType, TYPE_LABELS, watchLabel, watchPercent } from '../src/services/task-meta'
import type { TorrentStatus } from '../src/types'

describe('formatSize', () => {
  it('renders 0 for empty or invalid values', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(NaN)).toBe('0 B')
  })
  it('scales units and drops decimals for bytes', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1024 ** 2 * 32.9)).toBe('32.9 MB')
    expect(formatSize(1024 ** 3)).toBe('1.0 GB')
  })
})

describe('taskType', () => {
  it('defaults legacy tasks without a type to bt', () => {
    expect(taskType({ type: undefined } as TorrentStatus)).toBe('bt')
    expect(taskType({ type: 'video' } as TorrentStatus)).toBe('video')
  })
})

describe('watchLabel / watchPercent', () => {
  it('treats missing or empty progress as 未观看', () => {
    expect(watchLabel(null)).toBe('未观看')
    expect(watchLabel({ position: 0, duration: 600, updatedAt: 0 })).toBe('未观看')
    expect(watchPercent(null)).toBe(0)
  })
  it('rounds the watched fraction and clamps to 100', () => {
    expect(watchPercent({ position: 150, duration: 600, updatedAt: 0 })).toBe(25)
    expect(watchLabel({ position: 150, duration: 600, updatedAt: 0 })).toBe('已看 25%')
    expect(watchPercent({ position: 9999, duration: 600, updatedAt: 0 })).toBe(100)
  })
  it('marks near-finished and unknown-duration cases', () => {
    expect(watchLabel({ position: 590, duration: 600, updatedAt: 0 })).toBe('已看完')
    // duration 未知（部分流探测不到总时长）时退化为「观看中」
    expect(watchLabel({ position: 42, duration: 0, updatedAt: 0 })).toBe('观看中')
  })
})

describe('labels', () => {
  it('covers every protocol and status used by the UI', () => {
    for (const type of ['bt', 'http', 'ftp', 'metalink', 'video'] as const) expect(TYPE_LABELS[type]).toBeTruthy()
    for (const status of ['parsing', 'connecting', 'downloading', 'seeding', 'paused', 'error'] as const) expect(STATUS_LABELS[status]).toBeTruthy()
  })
})
