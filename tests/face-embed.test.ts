import { describe, expect, it } from 'vitest'
import { cosine, l2Normalize, sfaceInput } from '../src/services/face-embed'

describe('sfaceInput', () => {
  it('按 NCHW 排列 RGB 三个通道，像素保持 0–255 不做归一化（与 OpenCV blobFromImage(scale=1, swapRB) 一致）', () => {
    // 2×2 图像：每个像素 RGBA = (10·i, 20·i, 30·i, 255)
    const rgba = new Uint8ClampedArray([0, 0, 0, 255, 10, 20, 30, 255, 20, 40, 60, 255, 30, 60, 90, 255])
    const out = sfaceInput(rgba, 2)
    expect(Array.from(out.slice(0, 4))).toEqual([0, 10, 20, 30])
    expect(Array.from(out.slice(4, 8))).toEqual([0, 20, 40, 60])
    expect(Array.from(out.slice(8, 12))).toEqual([0, 30, 60, 90])
  })
})

describe('l2Normalize / cosine', () => {
  it('归一化后模长为 1，零向量不会产生 NaN', () => {
    const v = l2Normalize([3, 4])
    expect(Math.hypot(...v)).toBeCloseTo(1, 9)
    expect(l2Normalize([0, 0])).toEqual([0, 0])
  })

  it('余弦相似度：同向为 1、正交为 0、反向为 -1，与缩放无关', () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 9)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 9)
    expect(cosine([1, 2], [-1, -2])).toBeCloseTo(-1, 9)
    expect(cosine([1, 2], [10, 20])).toBeCloseTo(1, 9)
  })
})
