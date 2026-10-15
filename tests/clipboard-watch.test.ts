import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClipboardWatcher, extractClipboardInput } from '../electron/clipboard-watch'

const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'

describe('extractClipboardInput', () => {
  it('识别磁力与直链', () => {
    expect(extractClipboardInput(magnet)).toBe(magnet)
    expect(extractClipboardInput('https://example.com/a.mp4')).toBe('https://example.com/a.mp4')
    expect(extractClipboardInput('  ftp://example.com/a.bin\n')).toBe('ftp://example.com/a.bin')
  })

  it('从带前后缀的文本里挑出链接并剔除引号/尖括号', () => {
    expect(extractClipboardInput(`复制这段：<${magnet}> 谢谢`)).toBe(magnet)
    expect(extractClipboardInput('"https://example.com/a.zip"，下载地址')).toBe('https://example.com/a.zip')
    expect(extractClipboardInput('Download: https://example.com/a.zip')).toBe('https://example.com/a.zip')
  })

  it('普通文本、空值与超长文本返回 null', () => {
    expect(extractClipboardInput('hello world')).toBeNull()
    expect(extractClipboardInput('')).toBeNull()
    expect(extractClipboardInput('   ')).toBeNull()
    expect(extractClipboardInput(`https://example.com/${'a'.repeat(9000)}`)).toBeNull()
  })
})

describe('createClipboardWatcher', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('只在内容变化且是链接时回调一次', () => {
    let clipboard = 'nothing'
    const onInput = vi.fn()
    const watcher = createClipboardWatcher({ read: () => clipboard, onInput, intervalMs: 1000 })
    watcher.start()
    // 启动时已存在的内容不提示
    vi.advanceTimersByTime(3000)
    expect(onInput).not.toHaveBeenCalled()

    clipboard = magnet
    vi.advanceTimersByTime(3000)
    expect(onInput).toHaveBeenCalledTimes(1)
    expect(onInput).toHaveBeenCalledWith(magnet)

    // 同一段文本重复出现不再提示
    vi.advanceTimersByTime(5000)
    expect(onInput).toHaveBeenCalledTimes(1)

    // 换成另一条链接会再提示
    clipboard = 'https://example.com/other.mp4'
    vi.advanceTimersByTime(2000)
    expect(onInput).toHaveBeenCalledTimes(2)
  })

  it('ignore 的链接不再提示', () => {
    let clipboard = ''
    const onInput = vi.fn()
    const watcher = createClipboardWatcher({ read: () => clipboard, onInput, intervalMs: 1000 })
    watcher.start()
    watcher.ignore('https://example.com/skip.zip')
    clipboard = 'https://example.com/skip.zip'
    vi.advanceTimersByTime(3000)
    expect(onInput).not.toHaveBeenCalled()
  })

  it('stop 之后不再读取剪贴板', () => {
    let reads = 0
    const watcher = createClipboardWatcher({ read: () => { reads++; return magnet }, onInput: vi.fn(), intervalMs: 1000 })
    watcher.start()
    expect(watcher.isRunning()).toBe(true)
    vi.advanceTimersByTime(2000)
    const afterStart = reads
    watcher.stop()
    expect(watcher.isRunning()).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(reads).toBe(afterStart)
  })

  it('重复 start 不会叠加定时器', () => {
    let reads = 0
    const watcher = createClipboardWatcher({ read: () => { reads++; return 'x' }, onInput: vi.fn(), intervalMs: 1000 })
    watcher.start(); watcher.start()
    vi.advanceTimersByTime(1000)
    // 一次 getter 调用（start 里的种子读取）+ 一次 tick
    expect(reads).toBe(2)
  })
})
