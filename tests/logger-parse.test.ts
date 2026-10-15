import { describe, expect, it } from 'vitest'
import { parseLogLine } from '../electron/logger'

describe('parseLogLine', () => {
  it('解析标准格式', () => {
    expect(parseLogLine('[2026-10-15T15:00:00.000Z] [ERROR] [aria2] 启动失败')).toEqual({
      time: '2026-10-15T15:00:00.000Z', level: 'ERROR', tag: 'aria2', message: '启动失败',
      raw: '[2026-10-15T15:00:00.000Z] [ERROR] [aria2] 启动失败'
    })
  })

  it('消息里含方括号或换行标记也完整保留', () => {
    const entry = parseLogLine('[t] [INFO] [tasks] 内容 [有] 方括号')
    expect(entry?.message).toBe('内容 [有] 方括号')
  })

  it('小写级别统一成大写', () => {
    expect(parseLogLine('[t] [warn] [x] y')?.level).toBe('WARN')
  })

  it('格式不符的行按原文保留，空行丢弃', () => {
    expect(parseLogLine('  堆栈片段 at foo()')).toEqual({ time: '', level: 'RAW', tag: '', message: '  堆栈片段 at foo()', raw: '  堆栈片段 at foo()' })
    expect(parseLogLine('')).toBeNull()
    expect(parseLogLine('   ')).toBeNull()
    expect(parseLogLine('a\r')).toMatchObject({ level: 'RAW', raw: 'a' })
  })
})
