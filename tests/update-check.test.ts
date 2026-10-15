import { describe, expect, it } from 'vitest'
import { isNewerVersion, normalizeVersion, parseLatestRelease } from '../electron/update-check'

describe('normalizeVersion', () => {
  it('去 v 前缀并补足三段', () => {
    expect(normalizeVersion('v1.2.3')).toEqual([1, 2, 3])
    expect(normalizeVersion('1.2')).toEqual([1, 2, 0])
    expect(normalizeVersion('2')).toEqual([2, 0, 0])
  })

  it('预发布与构建后缀不参与比较', () => {
    expect(normalizeVersion('1.0.0-beta.1')).toEqual([1, 0, 0])
    expect(normalizeVersion('1.0.0+build7')).toEqual([1, 0, 0])
  })

  it('非法输入退化为 0', () => {
    expect(normalizeVersion('')).toEqual([0, 0, 0])
    expect(normalizeVersion('abc')).toEqual([0, 0, 0])
  })
})

describe('isNewerVersion', () => {
  it('更高的次版本/修订号算新版本', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('v2.0.0', '1.9.9')).toBe(true)
  })

  it('相同或更低不算新版本', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('0.9.9', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0-beta.2', '1.0.0')).toBe(false)
  })

  it('位数不同也能比较', () => {
    expect(isNewerVersion('1.2', '1.1.9')).toBe(true)
    expect(isNewerVersion('1.2.0', '1.2')).toBe(false)
  })
})

describe('parseLatestRelease', () => {
  it('解析出可用的 Release 信息', () => {
    const json = JSON.stringify({ tag_name: 'v1.2.0', html_url: 'https://github.com/dsjerry/btviewer/releases/tag/v1.2.0', published_at: '2026-01-01T00:00:00Z', body: ' 修复若干问题 ' })
    expect(parseLatestRelease(json)).toEqual({
      version: '1.2.0',
      url: 'https://github.com/dsjerry/btviewer/releases/tag/v1.2.0',
      publishedAt: '2026-01-01T00:00:00Z',
      notes: '修复若干问题'
    })
  })

  it('缺少 tag_name 或非法 JSON 返回 null', () => {
    expect(parseLatestRelease(JSON.stringify({ message: 'Not Found' }))).toBeNull()
    expect(parseLatestRelease('not json')).toBeNull()
  })

  it('过长的更新说明被截断', () => {
    const release = parseLatestRelease(JSON.stringify({ tag_name: 'v1.0.0', body: 'x'.repeat(2000) }))
    expect(release?.notes.length).toBe(600)
  })
})
