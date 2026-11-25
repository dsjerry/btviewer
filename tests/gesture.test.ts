import { describe, expect, it } from 'vitest'
import { classifyPose, fingerStates, GestureTracker, type Point } from '../src/services/gesture'

// 合成一只竖直向上的手：腕部在下方，每根手指的 PIP 与指尖按伸直/弯曲设置位置
function hand(extended: [boolean, boolean, boolean, boolean], indexX = 0.5): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6 }))
  points[0] = { x: 0.5, y: 0.9 }
  const joints: Array<[number, number]> = [[6, 8], [10, 12], [14, 16], [18, 20]]
  joints.forEach(([pip, tip], finger) => {
    const x = finger === 0 ? indexX : 0.5 + finger * 0.05
    points[pip] = { x, y: 0.65 }
    points[tip] = { x, y: extended[finger] ? 0.45 : 0.8 }
  })
  return points
}

describe('classifyPose', () => {
  it('四指伸直为张掌，四指弯曲为握拳，仅食指伸直为指向', () => {
    expect(classifyPose(hand([true, true, true, true]))).toBe('palm')
    expect(classifyPose(hand([false, false, false, false]))).toBe('fist')
    expect(classifyPose(hand([true, false, false, false]))).toBe('point')
  })

  it('其它组合不触发任何手势', () => {
    expect(classifyPose(hand([true, true, false, false]))).toBeNull()
    expect(fingerStates(hand([true, false, true, false]))).toEqual([true, false, true, false])
  })
})

describe('GestureTracker', () => {
  it('张掌连续确认 3 帧后触发一次播放/暂停，持续按住不重复触发', () => {
    const tracker = new GestureTracker()
    const palm = hand([true, true, true, true])
    expect(tracker.push(palm, 0)).toBeNull()
    expect(tracker.push(palm, 100)).toBeNull()
    expect(tracker.push(palm, 200)).toBe('toggle-play')
    expect(tracker.push(palm, 300)).toBeNull()
    expect(tracker.push(palm, 400)).toBeNull()
  })

  it('冷却时间内的重复张掌不再触发，冷却结束后可再次触发', () => {
    const tracker = new GestureTracker()
    const palm = hand([true, true, true, true])
    const fist = hand([false, false, false, false])
    for (let t = 0; t < 3; t++) tracker.push(palm, t * 50)
    tracker.push(fist, 300)
    tracker.push(palm, 400)
    tracker.push(palm, 450)
    expect(tracker.push(palm, 500)).toBeNull()
    tracker.push(fist, 900)
    tracker.push(fist, 950)
    tracker.push(fist, 1000)
    tracker.push(palm, 1100)
    tracker.push(palm, 1150)
    expect(tracker.push(palm, 1200)).toBe('toggle-play')
  })

  it('握拳连续确认后触发静音切换', () => {
    const tracker = new GestureTracker()
    const fist = hand([false, false, false, false])
    tracker.push(fist, 0)
    tracker.push(fist, 50)
    expect(tracker.push(fist, 100)).toBe('toggle-mute')
  })

  it('食指向用户右侧挥动（画面 x 减小）快进，向左挥动快退', () => {
    const forward = new GestureTracker()
    forward.push(hand([true, false, false, false], 0.7), 0)
    expect(forward.push(hand([true, false, false, false], 0.45), 200)).toBe('seek-forward')

    const backward = new GestureTracker()
    backward.push(hand([true, false, false, false], 0.3), 0)
    expect(backward.push(hand([true, false, false, false], 0.55), 200)).toBe('seek-backward')
  })

  it('挥动幅度不足或超过窗口时间不触发', () => {
    const tracker = new GestureTracker()
    tracker.push(hand([true, false, false, false], 0.6), 0)
    expect(tracker.push(hand([true, false, false, false], 0.5), 100)).toBeNull()
    expect(tracker.push(hand([true, false, false, false], 0.2), 900)).toBeNull()
  })

  it('画面中无手或姿势中断时重置状态', () => {
    const tracker = new GestureTracker()
    const palm = hand([true, true, true, true])
    tracker.push(palm, 0)
    tracker.push(palm, 50)
    expect(tracker.push(null, 100)).toBeNull()
    tracker.push(palm, 150)
    tracker.push(palm, 200)
    expect(tracker.push(palm, 250)).toBe('toggle-play')
  })
})
