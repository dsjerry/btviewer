import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
import { resolveAria2Binary } from '../electron/torrent-engine'

// aria2 二进制按 <platform>-<arch> 分目录：找不到自己那份时会退回错误架构的二进制（如 mac 上跑 Linux ELF）
function fixture(files: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'btviewer-aria2-'))
  for (const relative of files) {
    mkdirSync(join(root, relative, '..'), { recursive: true })
    writeFileSync(join(root, relative), '')
  }
  return root
}

describe('resolveAria2Binary', () => {
  it('按平台与架构命中子目录', () => {
    const root = fixture(['mac-arm64/aria2c', 'mac-x64/aria2c', 'win-x64/aria2c.exe'])
    expect(resolveAria2Binary(root, 'mac', 'arm64')).toBe(join(root, 'mac-arm64', 'aria2c'))
    expect(resolveAria2Binary(root, 'mac', 'x64')).toBe(join(root, 'mac-x64', 'aria2c'))
    expect(resolveAria2Binary(root, 'win', 'x64')).toBe(join(root, 'win-x64', 'aria2c.exe'))
  })

  it('当前架构缺失时不误用其它架构的二进制', () => {
    const root = fixture(['mac-arm64/aria2c'])
    expect(resolveAria2Binary(root, 'mac', 'x64')).toBeNull()
    expect(resolveAria2Binary(root, 'win', 'arm64')).toBeNull()
  })

  it('兼容旧布局（根目录直接放 aria2c / aria2c.exe）', () => {
    const archived = fixture(['linux-x64/aria2c'])
    expect(resolveAria2Binary(archived, 'linux', 'x64')).toBe(join(archived, 'linux-x64', 'aria2c'))
    const legacy = fixture(['aria2c'])
    expect(resolveAria2Binary(legacy, 'linux', 'x64')).toBe(join(legacy, 'aria2c'))
    const legacyWin = fixture(['aria2c.exe'])
    expect(resolveAria2Binary(legacyWin, 'win', 'x64')).toBe(join(legacyWin, 'aria2c.exe'))
  })

  it('目录为空时返回 null（由调用方回退到 PATH）', () => {
    expect(resolveAria2Binary(fixture(['icon.png']), 'linux', 'x64')).toBeNull()
  })
})
