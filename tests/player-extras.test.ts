import { describe, expect, it } from 'vitest'
import { formatMark, parseMarksStore, sanitizeMarks, skipDecision, updateMarksStore } from '../src/services/player-extras'

describe('sanitizeMarks', () => {
  it('丢弃过短或非法的标记', () => {
    expect(sanitizeMarks({})).toEqual({})
    expect(sanitizeMarks({ introEnd: 2 })).toEqual({})
    expect(sanitizeMarks({ introEnd: Number.NaN })).toEqual({})
  })

  it('按片长收敛越界标记', () => {
    expect(sanitizeMarks({ introEnd: 500, outroStart: 99999 }, 600)).toEqual({ introEnd: 500, outroStart: 599 })
    expect(sanitizeMarks({ introEnd: 500, outroStart: 520 }, 600)).toEqual({ outroStart: 520 })
  })

  it('片头与片尾之间不足 30 秒时丢弃片头', () => {
    expect(sanitizeMarks({ introEnd: 100, outroStart: 120 })).toEqual({ outroStart: 120 })
    expect(sanitizeMarks({ introEnd: 100, outroStart: 200 })).toEqual({ introEnd: 100, outroStart: 200 })
  })
})

describe('skipDecision', () => {
  const marks = { introEnd: 90, outroStart: 1400 }

  it('关闭时永不跳转', () => {
    expect(skipDecision(10, 1500, marks, false)).toBeNull()
    expect(skipDecision(10, 1500, {}, true)).toBeNull()
  })

  it('片头区间内跳到片头结束', () => {
    expect(skipDecision(10, 1500, marks, true)).toEqual({ action: 'intro', target: 90, label: '已跳过片头（1:30）' })
    expect(skipDecision(89.2, 1500, marks, true)?.action).toBe('intro')
  })

  it('片头边界外不触发（避免反复跳）', () => {
    expect(skipDecision(89.6, 1500, marks, true)).toBeNull()
    expect(skipDecision(0.2, 1500, marks, true)).toBeNull()
  })

  it('片尾区间内跳过片尾', () => {
    const decision = skipDecision(1400, 1500, marks, true)
    expect(decision?.action).toBe('outro')
    expect(decision?.target).toBe(1500)
  })

  it('播到最后一刻不再触发片尾', () => {
    expect(skipDecision(1499.9, 1500, marks, true)).toBeNull()
  })

  it('非法输入返回 null', () => {
    expect(skipDecision(Number.NaN, 1500, marks, true)).toBeNull()
    expect(skipDecision(-5, 1500, marks, true)).toBeNull()
  })
})

describe('formatMark', () => {
  it('转成 m:ss', () => {
    expect(formatMark(0)).toBe('0:00')
    expect(formatMark(90)).toBe('1:30')
    expect(formatMark(3725)).toBe('62:05')
    expect(formatMark(Number.NaN)).toBe('0:00')
  })
})

describe('mark store', () => {
  it('解析损坏或空的 JSON 得到空库', () => {
    expect(parseMarksStore(null)).toEqual({})
    expect(parseMarksStore('not json')).toEqual({})
    expect(parseMarksStore('null')).toEqual({})
  })

  it('解析时顺带清理非法标记', () => {
    expect(parseMarksStore(JSON.stringify({ 'planet earth ii': { introEnd: 60, outroStart: 1200 }, bad: { introEnd: 1 }, junk: 3 }))).toEqual({ 'planet earth ii': { introEnd: 60, outroStart: 1200 } })
  })

  it('写入与清除标记', () => {
    const store = updateMarksStore({}, 'show a', { introEnd: 60 })
    expect(store).toEqual({ 'show a': { introEnd: 60 } })
    expect(updateMarksStore(store, 'show a', {})).toEqual({})
  })
})
