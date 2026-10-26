import { describe, expect, it } from 'vitest'
import { fieldPatch, requiresEngineRestart, validateField } from '../src/services/settings-fields'

describe('validateField', () => {
  it('合法输入返回空串', () => {
    expect(validateField('trackers', 'udp://tracker.example.org:1337/announce', {})).toBe('')
    expect(validateField('proxy', 'socks5://127.0.0.1:1080', {})).toBe('')
    expect(validateField('speedLimit', '10M', {})).toBe('')
    expect(validateField('listenPort', '6881-6999', {})).toBe('')
  })

  it('空值视为「使用默认」，不算错误', () => {
    for (const field of ['trackers', 'proxy', 'speedLimit', 'listenPort'] as const) {
      expect(validateField(field, '   ', {})).toBe('')
    }
  })

  it('拒绝非法 tracker 与代理', () => {
    expect(validateField('trackers', 'tracker.example.org', {})).toContain('无效 tracker')
    expect(validateField('proxy', '127.0.0.1:7890', {})).toContain('格式无效')
  })

  it('做种参数只在对应模式下校验', () => {
    expect(validateField('seedRatio', '150', { seedMode: 'ratio' })).not.toBe('')
    expect(validateField('seedRatio', '150', { seedMode: 'time' })).toBe('')
    expect(validateField('seedMinutes', '0', { seedMode: 'time' })).not.toBe('')
  })

  it('关闭自动重试时不校验重试次数', () => {
    expect(validateField('maxRetries', '99', { autoRetry: true })).not.toBe('')
    expect(validateField('maxRetries', '99', { autoRetry: false })).toBe('')
  })
})

describe('fieldPatch', () => {
  const current = { trackers: '', proxy: '', speedLimit: '0', listenPort: '', httpSplit: 8, maxConcurrentDownloads: 5, seedRatio: 1, seedMinutes: 60, maxRetries: 3, ytdlpPath: '', ytdlpBrowser: '' }

  it('值没变时不提交（避免每次失焦都写盘）', () => {
    expect(fieldPatch('httpSplit', '8', current)).toBeNull()
    expect(fieldPatch('speedLimit', '', current)).toBeNull()
    expect(fieldPatch('trackers', '', current)).toBeNull()
  })

  it('文本字段去空格后提交', () => {
    expect(fieldPatch('proxy', '  http://127.0.0.1:7890 ', current)).toEqual({ proxy: 'http://127.0.0.1:7890' })
  })

  it('限速空值归一化为 0（aria2 的不限速）', () => {
    expect(fieldPatch('speedLimit', '', { ...current, speedLimit: '10M' })).toEqual({ speedLimit: '0' })
  })

  it('数字字段越界时钳制到范围内', () => {
    expect(fieldPatch('httpSplit', '99', current)).toEqual({ httpSplit: 16 })
    expect(fieldPatch('httpSplit', '0', current)).toEqual({ httpSplit: 1 })
    expect(fieldPatch('maxConcurrentDownloads', '20', current)).toEqual({ maxConcurrentDownloads: 10 })
    expect(fieldPatch('maxRetries', '-3', current)).toEqual({ maxRetries: 0 })
  })

  it('数字字段为空或非数字时回退到原值（不写入 NaN）', () => {
    expect(fieldPatch('httpSplit', '', current)).toBeNull()
    expect(fieldPatch('httpSplit', 'abc', current)).toBeNull()
    expect(fieldPatch('seedRatio', '', current)).toBeNull()
  })
})

describe('requiresEngineRestart', () => {
  it('只有 aria2 命令行参数需要重启引擎', () => {
    expect(requiresEngineRestart('listenPort')).toBe(true)
    expect(requiresEngineRestart('speedLimit')).toBe(false)
    expect(requiresEngineRestart('trackers')).toBe(false)
  })
})
