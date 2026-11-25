import { describe, expect, it } from 'vitest'
import { alignmentPoints, applyAffine, ARCFACE_TEMPLATE, boundingBox, similarityTransform, type Point } from '../src/services/face-align'

const near = (actual: Point[], expected: Point[]) => {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((p, i) => {
    expect(p.x).toBeCloseTo(expected[i].x, 6)
    expect(p.y).toBeCloseTo(expected[i].y, 6)
  })
}

describe('similarityTransform', () => {
  it('模板映射到自身时为单位变换', () => {
    const m = similarityTransform(ARCFACE_TEMPLATE, ARCFACE_TEMPLATE)
    expect(m[0]).toBeCloseTo(1, 9)
    expect(m[1]).toBeCloseTo(0, 9)
    expect(m[4]).toBeCloseTo(0, 6)
    expect(m[5]).toBeCloseTo(0, 6)
  })

  it('能恢复缩放、旋转与平移组合后的关键点，映射方向为 src → dst', () => {
    const angle = (30 * Math.PI) / 180
    const scale = 2.5
    const src = ARCFACE_TEMPLATE.map((p) => ({
      x: scale * (Math.cos(angle) * p.x - Math.sin(angle) * p.y) + 10,
      y: scale * (Math.sin(angle) * p.x + Math.cos(angle) * p.y) - 5
    }))
    const m = similarityTransform(src, ARCFACE_TEMPLATE)
    near(src.map((p) => applyAffine(m, p)), ARCFACE_TEMPLATE)
  })

  it('不含镜像：线性部分的行列式恒为正（a² + b²）', () => {
    const src = ARCFACE_TEMPLATE.map((p) => ({ x: p.y * 1.3, y: p.x * 0.7 }))
    const [a, b, c, d] = similarityTransform(src, ARCFACE_TEMPLATE)
    expect(a * d - b * c).toBeGreaterThan(0)
  })
})

describe('alignmentPoints', () => {
  it('从 478 点中取出眼、鼻、嘴 5 点，并按画面 x 排序，与模板点序一致', () => {
    const landmarks: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
    landmarks[468] = { x: 0.6, y: 0.4 }
    landmarks[473] = { x: 0.4, y: 0.4 }
    landmarks[1] = { x: 0.5, y: 0.5 }
    landmarks[61] = { x: 0.55, y: 0.7 }
    landmarks[291] = { x: 0.45, y: 0.7 }
    const pts = alignmentPoints(landmarks, 100, 200)
    near(pts, [{ x: 40, y: 80 }, { x: 60, y: 80 }, { x: 50, y: 100 }, { x: 45, y: 140 }, { x: 55, y: 140 }])
  })
})

describe('boundingBox', () => {
  it('返回像素外接框 [x, y, w, h]', () => {
    expect(boundingBox([{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }], 100, 50)).toEqual([10, 10, 40, 20])
  })
})
