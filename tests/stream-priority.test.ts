import { describe, expect, it } from 'vitest'
import { DEFAULT_READ_WINDOW, PRIORITIZE_HEAD_MAX, PRIORITIZE_TAIL, ariaSize, byteOffsetFor, prioritizePieceOption } from '../electron/stream-priority'

describe('ariaSize', () => {
  it('按 1024 进制给出 K/M 写法', () => {
    expect(ariaSize(512)).toBe('512')
    expect(ariaSize(1024)).toBe('1K')
    expect(ariaSize(512 * 1024)).toBe('512K')
    expect(ariaSize(4 * 1024 * 1024)).toBe('4M')
    expect(ariaSize(64 * 1024 * 1024)).toBe('64M')
  })

  it('非法输入退化为 0', () => {
    expect(ariaSize(-1)).toBe('0')
    expect(ariaSize(Number.NaN)).toBe('0')
  })
})

describe('prioritizePieceOption', () => {
  it('从头开始播放时使用默认预读窗口', () => {
    expect(prioritizePieceOption(0)).toBe(`head=${ariaSize(DEFAULT_READ_WINDOW)},tail=4M`)
  })

  it('head 随播放位置前移，并包含预读窗口', () => {
    expect(prioritizePieceOption(10 * 1024 * 1024)).toBe('head=18M,tail=4M')
  })

  it('head 有下限（预读窗口很小时仍保证起播数据量）', () => {
    expect(prioritizePieceOption(0, 1024)).toBe(`head=${ariaSize(2 * 1024 * 1024)},tail=4M`)
  })

  it('head 有上限（避免把整个文件都标成优先）', () => {
    expect(prioritizePieceOption(8 * 1024 * 1024 * 1024)).toBe(`head=${ariaSize(PRIORITIZE_HEAD_MAX)},tail=${ariaSize(PRIORITIZE_TAIL)}`)
  })

  it('非法输入按从头播放处理', () => {
    expect(prioritizePieceOption(Number.NaN)).toBe(`head=${ariaSize(DEFAULT_READ_WINDOW)},tail=4M`)
    expect(prioritizePieceOption(-5)).toBe(`head=${ariaSize(DEFAULT_READ_WINDOW)},tail=4M`)
  })
})

describe('byteOffsetFor', () => {
  it('按播放比例换算字节偏移', () => {
    expect(byteOffsetFor(60, 120, 1000)).toBe(500)
  })

  it('duration 未知或非法时退化为 0', () => {
    expect(byteOffsetFor(60, 0, 1000)).toBe(0)
    expect(byteOffsetFor(Number.NaN, 120, 1000)).toBe(0)
    expect(byteOffsetFor(60, 120, 0)).toBe(0)
  })

  it('播放位置超出时长时收敛到文件末尾', () => {
    expect(byteOffsetFor(200, 120, 1000)).toBe(1000)
  })
})
