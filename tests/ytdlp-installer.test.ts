import { describe, expect, it, vi } from 'vitest'
import { findChecksum, ytdlpAssetName } from '../electron/ytdlp-installer'

// 安装器模块引入了 electron（net），被测的纯函数不会触达它
vi.mock('electron', () => ({ net: {} }))

describe('ytdlpAssetName', () => {
  it('uses the self-contained exe on windows', () => {
    expect(ytdlpAssetName('win32')).toBe('yt-dlp.exe')
  })
  it('has no single-file asset for other platforms', () => {
    expect(ytdlpAssetName('linux')).toBe('')
    expect(ytdlpAssetName('darwin')).toBe('')
  })
})

describe('findChecksum', () => {
  const sums = [
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  yt-dlp',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *yt-dlp.exe',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp_linux.zip'
  ].join('\n')

  it('finds the checksum for the exact asset name', () => {
    expect(findChecksum(sums, 'yt-dlp.exe')).toBe('a'.repeat(64))
    expect(findChecksum(sums, 'yt-dlp')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
  it('returns null when the asset is missing', () => {
    expect(findChecksum(sums, 'yt-dlp_macos')).toBeNull()
    expect(findChecksum('', 'yt-dlp.exe')).toBeNull()
  })
})
