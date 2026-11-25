import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { trailingDebounce } from '../src/services/debounce'

describe('trailingDebounce', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('连续触发只在静默期结束后执行一次', () => {
    const fn = vi.fn()
    const debounced = trailingDebounce(fn, 800)
    debounced.call()
    vi.advanceTimersByTime(500)
    debounced.call()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancel 后不再执行', () => {
    const fn = vi.fn()
    const debounced = trailingDebounce(fn, 100)
    debounced.call()
    debounced.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })
})
