import { describe, expect, it, vi } from 'vitest'
import { denyAssetMessage, ensureExecutable, mergeYtdlpStatus } from '../electron/installer-support'

// 安装器模块引入了 electron（net/app），被测的纯函数不会触达它
vi.mock('electron', () => ({ net: {}, app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' } }))

describe('ytdlpAssetName', () => {
  it('各平台都命中官方自包含构建（不再是「仅 Windows」）', async () => {
    const { ytdlpAssetName } = await import('../electron/ytdlp-installer')
    expect(ytdlpAssetName('win32', 'x64')).toBe('yt-dlp.exe')
    expect(ytdlpAssetName('win32', 'arm64')).toBe('yt-dlp_arm64.exe')
    expect(ytdlpAssetName('win32', 'ia32')).toBe('yt-dlp_x86.exe')
    expect(ytdlpAssetName('darwin', 'arm64')).toBe('yt-dlp_macos')
    expect(ytdlpAssetName('darwin', 'x64')).toBe('yt-dlp_macos')
    expect(ytdlpAssetName('linux', 'x64')).toBe('yt-dlp_linux')
    expect(ytdlpAssetName('linux', 'arm64')).toBe('yt-dlp_linux_aarch64')
    expect(ytdlpAssetName('freebsd', 'x64')).toBe('')
  })
})

describe('denoAssetName', () => {
  it('按平台与架构选官方 zip', async () => {
    const { denoAssetName } = await import('../electron/ytdlp-installer')
    expect(denoAssetName('darwin', 'arm64')).toBe('deno-aarch64-apple-darwin.zip')
    expect(denoAssetName('darwin', 'x64')).toBe('deno-x86_64-apple-darwin.zip')
    expect(denoAssetName('win32', 'x64')).toBe('deno-x86_64-pc-windows-msvc.zip')
    expect(denoAssetName('linux', 'arm64')).toBe('deno-aarch64-unknown-linux-gnu.zip')
  })
})

describe('ffmpegStrategy', () => {
  it('Windows 走 gyan.dev 下载', async () => {
    const { ffmpegStrategy } = await import('../electron/ytdlp-installer')
    expect(ffmpegStrategy('win32', false)).toBe('download-windows')
    expect(ffmpegStrategy('win32', true)).toBe('download-windows')
  })
  it('macOS 优先用安装包内置版本，缺失时才联网下载', async () => {
    const { ffmpegStrategy } = await import('../electron/ytdlp-installer')
    expect(ffmpegStrategy('darwin', true)).toBe('bundled-macos')
    expect(ffmpegStrategy('darwin', false)).toBe('download-macos')
  })
  it('Linux 不做应用内安装', async () => {
    const { ffmpegStrategy } = await import('../electron/ytdlp-installer')
    expect(ffmpegStrategy('linux', true)).toBe('unsupported-linux')
  })
})

describe('installCapabilities / platformTag', () => {
  it('Linux 只关掉 ffmpeg 一键安装，yt-dlp 与 deno 仍可自动装', async () => {
    const { installCapabilities } = await import('../electron/ytdlp-installer')
    expect(installCapabilities('linux', 'x64')).toEqual({ ytdlp: true, ffmpeg: false, deno: true })
    expect(installCapabilities('win32', 'x64')).toEqual({ ytdlp: true, ffmpeg: true, deno: true })
    expect(installCapabilities('darwin', 'arm64')).toEqual({ ytdlp: true, ffmpeg: true, deno: true })
  })
  it('平台目录名与打包宏 ${os}-${arch} 一致', async () => {
    const { platformTag } = await import('../electron/ytdlp-installer')
    expect(platformTag('darwin', 'arm64')).toBe('mac-arm64')
    expect(platformTag('win32', 'x64')).toBe('win-x64')
    expect(platformTag('linux', 'x64')).toBe('linux-x64')
  })
})

describe('extractCommand', () => {
  it('三平台都用系统自带解压工具（Windows tar.exe / macOS ditto / Linux unzip）', async () => {
    const { extractCommand } = await import('../electron/ytdlp-installer')
    expect(extractCommand('/a.zip', '/d', 'win32').command.endsWith('tar.exe')).toBe(true)
    expect(extractCommand('/a.zip', '/d', 'darwin')).toEqual({ command: '/usr/bin/ditto', args: ['-x', '-k', '/a.zip', '/d'] })
    expect(extractCommand('/a.zip', '/d', 'linux')).toEqual({ command: 'unzip', args: ['-oq', '/a.zip', '-d', '/d'] })
  })
})

describe('findChecksum', () => {
  it('按资产名精确取哈希（兼容 * 二进制前缀）', async () => {
    const { findChecksum } = await import('../electron/ytdlp-installer')
    const sums = [
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  yt-dlp',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *yt-dlp_macos',
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb  yt-dlp_linux.zip'
    ].join('\n')
    expect(findChecksum(sums, 'yt-dlp.exe')).toBeNull()
    expect(findChecksum(sums, 'yt-dlp_macos')).toBe('a'.repeat(64))
    expect(findChecksum(sums, 'yt-dlp')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(findChecksum('', 'yt-dlp.exe')).toBeNull()
  })
})

// ── installer-support：不依赖 electron 的纯逻辑，权限分支可在任意平台测 ──

describe('ensureExecutable', () => {
  it('非 Windows 平台补齐 0755；Windows 不动权限', () => {
    const chmod = vi.fn()
    ensureExecutable('/bin/yt-dlp', { platform: 'darwin', chmod })
    expect(chmod).toHaveBeenCalledWith('/bin/yt-dlp', 0o755)
    chmod.mockClear()
    ensureExecutable('C:\\bin\\yt-dlp.exe', { platform: 'win32', chmod })
    expect(chmod).not.toHaveBeenCalled()
  })
  it('权限修改失败不应该让安装整体失败', () => {
    const chmod = () => { throw new Error('EROFS') }
    expect(() => ensureExecutable('/ro/yt-dlp', { platform: 'linux', chmod })).not.toThrow()
  })
})

describe('denyAssetMessage', () => {
  it('提示面向普通用户，不出现 pip/brew 这类开发者命令', () => {
    const message = denyAssetMessage('yt-dlp', { platform: 'linux', arch: 'riscv64' })
    expect(message).toContain('yt-dlp')
    expect(message).not.toMatch(/pip|brew|npm/)
  })
})

describe('mergeYtdlpStatus', () => {
  it('安装完成后把内置安装目录的二进制合并进状态，避免仍显示「未安装」', () => {
    const merged = mergeYtdlpStatus(
      { available: false, path: '', ffmpegAvailable: false, jsRuntime: null },
      { path: '/Users/me/Library/Application Support/BTViewer/bin/yt-dlp', ffmpeg: '/Users/me/Library/Application Support/BTViewer/bin/ffmpeg' }
    )
    expect(merged.available).toBe(true)
    expect(merged.path).toContain('yt-dlp')
    expect(merged.ffmpegAvailable).toBe(true)
  })
  it('已有可用路径时不被覆盖', () => {
    const merged = mergeYtdlpStatus(
      { available: true, path: '/opt/homebrew/bin/yt-dlp', ffmpegAvailable: true, jsRuntime: null },
      { path: '/x/yt-dlp', ffmpeg: '/x/ffmpeg' }
    )
    expect(merged.path).toBe('/opt/homebrew/bin/yt-dlp')
  })
})
