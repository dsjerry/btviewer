import { describe, expect, it } from 'vitest'
import { validateListenPort, validateRetries, validateSeedMinutes, validateSeedRatio, validateSizeLimit } from '../src/services/validate'

describe('validateSizeLimit', () => {
  it('接受 aria2 的容量写法与 0', () => {
    for (const value of ['', '0', '10M', '512K', '1.5M', '2G']) expect(validateSizeLimit(value)).toBe('')
  })

  it('拒绝非法写法', () => {
    for (const value of ['10MB', 'M', '-1', 'abc', '10 M']) expect(validateSizeLimit(value)).not.toBe('')
  })
})

describe('validateListenPort', () => {
  it('接受空值、单端口与区间', () => {
    for (const value of ['', '6881', '6881-6999', '51413']) expect(validateListenPort(value)).toBe('')
  })

  it('拒绝越界与倒序区间', () => {
    expect(validateListenPort('0')).not.toBe('')
    expect(validateListenPort('70000')).not.toBe('')
    expect(validateListenPort('6999-6881')).not.toBe('')
    expect(validateListenPort('6881-')).not.toBe('')
  })
})

describe('validateSeedRatio / validateSeedMinutes / validateRetries', () => {
  it('分享率范围 0-100', () => {
    expect(validateSeedRatio(0)).toBe('')
    expect(validateSeedRatio(2.5)).toBe('')
    expect(validateSeedRatio(101)).not.toBe('')
    expect(validateSeedRatio(Number.NaN)).not.toBe('')
  })

  it('做种时长 1 分钟 - 30 天', () => {
    expect(validateSeedMinutes(60)).toBe('')
    expect(validateSeedMinutes(60 * 24 * 30)).toBe('')
    expect(validateSeedMinutes(0)).not.toBe('')
    expect(validateSeedMinutes(60 * 24 * 31)).not.toBe('')
  })

  it('重试次数 0-10', () => {
    expect(validateRetries(0)).toBe('')
    expect(validateRetries(3)).toBe('')
    expect(validateRetries(11)).not.toBe('')
    expect(validateRetries(-1)).not.toBe('')
  })
})
