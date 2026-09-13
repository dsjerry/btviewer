import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readJson, writeJsonAtomic } from '../electron/storage'

describe('writeJsonAtomic', () => {
  const dir = mkdtempSync(join(tmpdir(), 'btviewer-storage-'))
  const file = join(dir, 'store.json')

  it('writes and reads back JSON', () => {
    writeJsonAtomic(file, { a: 1, b: '文本' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1, b: '文本' })
  })

  it('leaves no .tmp file behind', () => {
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('overwrites existing content atomically', () => {
    writeJsonAtomic(file, { v: 1 })
    writeJsonAtomic(file, { v: 2 })
    expect(readJson(file, null)).toEqual({ v: 2 })
    expect(existsSync(`${file}.tmp`)).toBe(false)
  })

  it('supports pretty printing', () => {
    const pretty = join(dir, 'pretty.json')
    writeJsonAtomic(pretty, { x: 1 }, 2)
    expect(readFileSync(pretty, 'utf8')).toBe('{\n  "x": 1\n}')
  })
})

describe('readJson', () => {
  it('returns fallback for missing files', () => {
    expect(readJson(join(tmpdir(), 'btviewer-missing.json'), { ok: false })).toEqual({ ok: false })
  })

  it('returns fallback for corrupted content', () => {
    const file = join(tmpdir(), 'btviewer-corrupt.json')
    writeFileSync(file, '{ not valid json', 'utf8')
    expect(readJson(file, [])).toEqual([])
  })
})
