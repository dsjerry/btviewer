import { describe, expect, it } from 'vitest'
import { planPostAction, powerCommand, resolveOpenTarget, shouldRunPostAction, type CompletedTaskInfo } from '../electron/post-action'

const task: CompletedTaskInfo = {
  name: 'Show.S01E01',
  saveDir: '/dl/Show',
  paths: [
    { path: '/dl/Show/cover.jpg', kind: 'other' },
    { path: '/dl/Show/ep1.srt', kind: 'subtitle' },
    { path: '/dl/Show/ep1.mkv', kind: 'video' }
  ]
}

describe('shouldRunPostAction', () => {
  it('none 永不执行', () => {
    expect(shouldRunPostAction('none', 0)).toBe(false)
  })

  it('队列还有任务在下载时不执行（做种不算）', () => {
    expect(shouldRunPostAction('quit', 0)).toBe(true)
    expect(shouldRunPostAction('quit', 1)).toBe(false)
    expect(shouldRunPostAction('shutdown', 2)).toBe(false)
  })
})

describe('resolveOpenTarget', () => {
  it('打开目录用任务保存目录', () => {
    expect(resolveOpenTarget('openDir', task)).toEqual({ path: '/dl/Show', kind: 'openDir' })
  })

  it('打开文件优先视频，其次音频', () => {
    expect(resolveOpenTarget('openFile', task)).toEqual({ path: '/dl/Show/ep1.mkv', kind: 'openFile' })
    const audioOnly: CompletedTaskInfo = { ...task, paths: [{ path: '/dl/a.flac', kind: 'audio' }] }
    expect(resolveOpenTarget('openFile', audioOnly)).toEqual({ path: '/dl/a.flac', kind: 'openFile' })
  })

  it('没有媒体文件时退回无媒体文件的第一项，再退回目录', () => {
    const noMedia: CompletedTaskInfo = { ...task, paths: [{ path: '/dl/Show/readme.txt', kind: 'other' }] }
    expect(resolveOpenTarget('openFile', noMedia)).toEqual({ path: '/dl/Show/readme.txt', kind: 'openFile' })
    expect(resolveOpenTarget('openFile', { ...task, paths: [] })).toEqual({ path: '/dl/Show', kind: 'openDir' })
  })

  it('任务信息缺失或不适用时返回 null', () => {
    expect(resolveOpenTarget('openFile', null)).toBeNull()
    expect(resolveOpenTarget('quit', task)).toBeNull()
  })
})

describe('powerCommand', () => {
  it('Windows：关机带 60 秒倒计时，睡眠走 SetSuspendState', () => {
    expect(powerCommand('shutdown', 'win32')).toEqual({ command: 'shutdown', args: ['/s', '/t', '60'] })
    expect(powerCommand('sleep', 'win32')?.command).toBe('rundll32.exe')
  })

  it('macOS 与 Linux 各自有对应命令', () => {
    expect(powerCommand('shutdown', 'darwin')?.command).toBe('osascript')
    expect(powerCommand('sleep', 'darwin')).toEqual({ command: 'pmset', args: ['sleepnow'] })
    expect(powerCommand('shutdown', 'linux')).toEqual({ command: 'systemctl', args: ['poweroff'] })
    expect(powerCommand('sleep', 'linux')).toEqual({ command: 'systemctl', args: ['suspend'] })
  })

  it('非电源动作返回 null', () => {
    expect(powerCommand('openDir', 'win32')).toBeNull()
    expect(powerCommand('none', 'win32')).toBeNull()
  })
})

describe('planPostAction', () => {
  it('队列空闲时给出可执行请求', () => {
    expect(planPostAction('openDir', task, 0, 'win32')).toMatchObject({ kind: 'openDir', path: '/dl/Show' })
    expect(planPostAction('quit', task, 0, 'win32')).toMatchObject({ kind: 'quit' })
    const shutdown = planPostAction('shutdown', task, 0, 'win32')
    expect(shutdown).toMatchObject({ kind: 'power', command: 'shutdown' })
    expect(shutdown?.message).toContain('shutdown /a')
  })

  it('队列未空闲或动作为 none 时不产生请求', () => {
    expect(planPostAction('openFile', task, 3, 'win32')).toBeNull()
    expect(planPostAction('none', task, 0, 'win32')).toBeNull()
  })

  it('没有可用目标路径时不产生请求', () => {
    expect(planPostAction('openDir', { name: 'x', saveDir: '', paths: [] }, 0, 'win32')).toBeNull()
  })
})
