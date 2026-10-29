import { describe, expect, it } from 'vitest'
import { isPieceDownloaded, isRangeDownloaded, pieceIndexesForRange, pieceLengthFromBitfield, probeRanges } from '../electron/piece-availability'

// 稀疏文件陷阱：aria2 下到任一分片，文件就以完整长度出现，statSync 不能代表「数据可用」

describe('pieceLengthFromBitfield', () => {
  it('按位数反推分片长度', () => {
    // 1512 位 = 378 个十六进制字符；79,003,6141 字节 → 每片约 52 万字节约 1MB? 实际按 ceil 计算
    expect(pieceLengthFromBitfield('ff'.repeat(8), 16 * 4 * 4)).toBe(4)
    expect(pieceLengthFromBitfield('', 100)).toBe(0)
    expect(pieceLengthFromBitfield('ff', 0)).toBe(0)
  })
})

describe('isPieceDownloaded', () => {
  // '8001' 两个字节：0x80 = 1000_0000 → 分片 0；0x01 = 0000_0001 → 分片 15
  const bitfield = '8001'

  it('按位读取（高位对应较小索引）', () => {
    expect(isPieceDownloaded(bitfield, 0)).toBe(true)
    expect(isPieceDownloaded(bitfield, 1)).toBe(false)
    expect(isPieceDownloaded(bitfield, 7)).toBe(false)
    expect(isPieceDownloaded(bitfield, 8)).toBe(false)
    expect(isPieceDownloaded(bitfield, 15)).toBe(true)
  })

  it('0xff 全部为 1', () => {
    for (let i = 0; i < 8; i++) expect(isPieceDownloaded('ff', i)).toBe(true)
  })

  it('越界或空值返回 false', () => {
    expect(isPieceDownloaded('', 0)).toBe(false)
    expect(isPieceDownloaded('ff', -1)).toBe(false)
    expect(isPieceDownloaded('ff', 999)).toBe(false)
  })
})

describe('pieceIndexesForRange', () => {
  const base = { pieceLength: 100, fileOffset: 0, fileLength: 1000 }

  it('小范围只涉及一个分片', () => {
    expect(pieceIndexesForRange({ ...base, rangeStart: 0, rangeEnd: 0 })).toEqual([0])
    expect(pieceIndexesForRange({ ...base, rangeStart: 150, rangeEnd: 180 })).toEqual([1])
  })

  it('跨分片的范围覆盖所有涉及的分片', () => {
    expect(pieceIndexesForRange({ ...base, rangeStart: 90, rangeEnd: 210 })).toEqual([0, 1, 2])
  })

  it('文件在任务中的偏移会被计入', () => {
    expect(pieceIndexesForRange({ ...base, fileOffset: 250, rangeStart: 0, rangeEnd: 10 })).toEqual([2])
  })

  it('空范围返回空数组', () => {
    expect(pieceIndexesForRange({ ...base, rangeStart: 50, rangeEnd: 49 })).toEqual([])
  })
})

describe('isRangeDownloaded', () => {
  const info = { pieceLength: 4, fileOffset: 0, fileLength: 32, rangeStart: 0, rangeEnd: 3 }

  it('没有 bitfield 时放行（无法判断不误伤）', () => {
    expect(isRangeDownloaded(undefined, info)).toBe(true)
    expect(isRangeDownloaded('', info)).toBe(true)
  })

  it('分片已下载时放行', () => {
    // 分片 0 = 位 0 → 0x80...
    expect(isRangeDownloaded('f0000000', info)).toBe(true)
  })

  it('分片未下载时判定为未就绪', () => {
    expect(isRangeDownloaded('00000000', info)).toBe(false)
    expect(isRangeDownloaded('10000000', info)).toBe(false)
  })
})

describe('probeRanges', () => {
  it('小文件只查头部', () => {
    expect(probeRanges(1024)).toEqual([{ start: 0, end: 1023 }])
  })

  it('大文件同时查头部与尾部（moov 常在尾部）', () => {
    const ranges = probeRanges(100 * 1024 * 1024)
    expect(ranges).toHaveLength(2)
    expect(ranges[0].start).toBe(0)
    expect(ranges[1].end).toBe(100 * 1024 * 1024 - 1)
  })

  it('无效长度返回空', () => {
    expect(probeRanges(0)).toEqual([])
    expect(probeRanges(Number.NaN)).toEqual([])
  })
})
