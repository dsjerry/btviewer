import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir = ''
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

// 每个测试重置模块缓存 + 独立 userData 目录（electron 模块 mock 读 dir）
const load = () => import('../electron/task-history')

const draft = (id: string) => ({
  id,
  name: `任务 ${id}`,
  type: 'bt' as const,
  source: `magnet:?xt=urn:btih:${id.padStart(40, '0')}`,
  totalSize: 1024,
  downloaded: 1024,
  saveDir: `/dl/${id}`,
  addedAt: 1
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'btviewer-task-history-'))
  vi.resetModules()
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('task-history 留档', () => {
  it('记录并按最近事件倒序列出', async () => {
    const { recordTaskHistory, listTaskHistory } = await load()
    recordTaskHistory({ ...draft('a'), addedAt: 1 })
    recordTaskHistory({ ...draft('b'), addedAt: 2, completedAt: 5 })
    const list = listTaskHistory()
    expect(list.map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(list[0].completedAt).toBe(5)
    expect(list[0].totalSize).toBe(1024)
  })

  it('同 id 合并：完成后移除补 removedAt/destroy，不产生两条', async () => {
    const { recordTaskHistory, listTaskHistory } = await load()
    recordTaskHistory({ ...draft('a'), completedAt: 10 })
    recordTaskHistory({ ...draft('a'), removedAt: 20, destroy: true })
    const list = listTaskHistory()
    expect(list).toHaveLength(1)
    expect(list[0].completedAt).toBe(10)
    expect(list[0].removedAt).toBe(20)
    expect(list[0].destroy).toBe(true)
  })

  it('超过 200 条按最近事件裁掉最老的', async () => {
    const { recordTaskHistory, listTaskHistory } = await load()
    for (let i = 0; i < 205; i++) recordTaskHistory({ ...draft(`h${String(i).padStart(3, '0')}`), addedAt: i })
    const list = listTaskHistory()
    expect(list).toHaveLength(200)
    expect(list.some((entry) => entry.id === 'h000')).toBe(false)
    expect(list.some((entry) => entry.id === 'h204')).toBe(true)
  })

  it('clearTaskHistory 清空全部留档', async () => {
    const { recordTaskHistory, clearTaskHistory, listTaskHistory } = await load()
    recordTaskHistory(draft('a'))
    expect(clearTaskHistory()).toEqual([])
    expect(listTaskHistory()).toEqual([])
  })

  it('无效条目抛错不写入', async () => {
    const { recordTaskHistory, listTaskHistory } = await load()
    expect(() => recordTaskHistory({ id: '', name: 'x', type: 'bt', source: 'magnet:?xt=urn:btih:00' })).toThrow()
    expect(listTaskHistory()).toEqual([])
  })
})
