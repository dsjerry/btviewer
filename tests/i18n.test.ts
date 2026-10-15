import { afterEach, describe, expect, it } from 'vitest'
import { getLanguage, messageEntry, messageKeys, setLanguage, t } from '../src/services/i18n'

afterEach(() => setLanguage('zh'))

describe('词条表', () => {
  it('每条都有中英两种文案', () => {
    const empty = messageKeys().filter((key) => {
      const entry = messageEntry(key)
      return !entry || !entry[0].trim() || !entry[1].trim()
    })
    expect(empty).toEqual([])
  })

  it('键名遵循 段.名 或 段.子段.名 的格式', () => {
    expect(messageKeys().every((key) => /^[a-z]+(\.[a-zA-Z]+){1,2}$/.test(key))).toBe(true)
  })
})

describe('t', () => {
  it('默认中文，切换到英文后取英文文案', () => {
    expect(t('nav.downloads')).toBe('下载任务')
    setLanguage('en')
    expect(t('nav.downloads')).toBe('Downloads')
    expect(getLanguage()).toBe('en')
  })

  it('替换占位符', () => {
    expect(t('downloads.summary', { active: 2, completed: 1 })).toBe('2 个进行中 · 1 个已完成')
    setLanguage('en')
    expect(t('downloads.summary', { active: 2, completed: 1 })).toBe('2 active · 1 completed')
  })

  it('占位符缺失时替换成空串，不残留 {name}', () => {
    expect(t('downloads.summary', { active: 1 })).not.toContain('{')
  })

  it('未知键返回键名（便于开发期发现漏翻）', () => {
    expect(t('nope.missing')).toBe('nope.missing')
  })

  it('非法语言值回退中文', () => {
    setLanguage('fr' as unknown as 'en')
    expect(t('nav.home')).toBe('首页')
  })
})
