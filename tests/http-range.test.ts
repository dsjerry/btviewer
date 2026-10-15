import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../electron/http-range'

describe('parseByteRange', () => {
  it('没有 Range 头 → 整文件 200', () => {
    expect(parseByteRange(undefined, 1000)).toEqual({ kind: 'full', start: 0, end: 999 })
  })

  it('bytes=A-B → 206 精确区间', () => {
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({ kind: 'partial', start: 100, end: 199 })
  })

  it('bytes=A- → 到文件末尾', () => {
    expect(parseByteRange('bytes=990-', 1000)).toEqual({ kind: 'partial', start: 990, end: 999 })
  })

  it('bytes=-N → 后缀范围（最后 N 字节）', () => {
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 })
    // N 大于文件大小时从 0 开始
    expect(parseByteRange('bytes=-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 })
  })

  it('B 超过文件末尾时收敛到末尾', () => {
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 })
  })

  it('语法错误或越界 → 416', () => {
    expect(parseByteRange('bytes=0-', 0)).toEqual({ kind: 'empty' })
    expect(parseByteRange('bytes=-', 1000)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=abc', 1000)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('items=0-10', 1000)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=500-100', 1000)).toEqual({ kind: 'invalid' })
    expect(parseByteRange('bytes=1000-', 1000)).toEqual({ kind: 'invalid' })
    expect(parseByteRange(undefined, 0)).toEqual({ kind: 'empty' })
  })
})
