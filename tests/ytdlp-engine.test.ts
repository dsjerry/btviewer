import { describe, expect, it } from 'vitest'
import { binaryVersionArgs, decodeLine, isRuntimeVersionSupported, jsRuntimeArg, parseProgressLine, parseRuntimeVersion, parseVideoProbe, videoFormat } from '../electron/ytdlp-engine'

describe('binaryVersionArgs', () => {
  it('uses ffmpeg’s single-dash version flag and yt-dlp’s double-dash flag', () => {
    expect(binaryVersionArgs('ffmpeg')).toEqual(['-version'])
    expect(binaryVersionArgs('yt-dlp')).toEqual(['--version'])
  })
})

describe('parseProgressLine', () => {
  it('parses percent, total size, speed and eta', () => {
    const progress = parseProgressLine('[download]  45.3% of  123.45MiB at    2.34MiB/s ETA 00:12')
    expect(progress).not.toBeNull()
    expect(progress!.percent).toBeCloseTo(45.3)
    expect(progress!.totalSize).toBeCloseTo(123.45 * 1024 ** 2)
    expect(progress!.speed).toBeCloseTo(2.34 * 1024 ** 2)
    expect(progress!.eta).toBe(12)
  })
  it('parses hh:mm:ss eta and byte units', () => {
    const progress = parseProgressLine('[download]   1.0% of 2.00GiB at 512.00KiB/s ETA 01:02:03')
    expect(progress!.totalSize).toBeCloseTo(2 * 1024 ** 3)
    expect(progress!.speed).toBeCloseTo(512 * 1024)
    expect(progress!.eta).toBe(3723)
  })
  it('handles estimated totals and unknown eta', () => {
    const progress = parseProgressLine('[download]   5.2% of ~ 12.34MiB at Unknown speed ETA Unknown')
    expect(progress!.percent).toBeCloseTo(5.2)
    expect(progress!.totalSize).toBeCloseTo(12.34 * 1024 ** 2)
    expect(progress!.speed).toBeUndefined()
    expect(progress!.eta).toBeUndefined()
  })
  it('parses the completion line without speed or eta', () => {
    const progress = parseProgressLine('[download] 100% of    1.00MiB in 00:05')
    expect(progress!.percent).toBe(100)
    expect(progress!.totalSize).toBeCloseTo(1024 ** 2)
  })
  it('returns null for non-progress lines', () => {
    expect(parseProgressLine('[download] Destination: Video [id].mp4')).toBeNull()
    expect(parseProgressLine('[Merger] Merging formats into "video.mp4"')).toBeNull()
    expect(parseProgressLine('C:\\downloads\\video.mp4')).toBeNull()
    expect(parseProgressLine('')).toBeNull()
  })
})

describe('parseVideoProbe', () => {
  it('extracts title, ext, size and duration from dump-single-json output', () => {
    const probe = parseVideoProbe(JSON.stringify({ _type: 'video', title: 'Test Video', ext: 'mp4', filesize: 1048576, duration: 61.5, extractor_key: 'Youtube' }))
    expect(probe).toEqual({ title: 'Test Video', ext: 'mp4', size: 1048576, duration: 61.5, extractor: 'Youtube' })
  })
  it('falls back to filesize_approx when filesize is missing', () => {
    const probe = parseVideoProbe(JSON.stringify({ title: 'x', filesize_approx: 2048 }))
    expect(probe!.size).toBe(2048)
  })
  it('rejects playlists and entries without a title', () => {
    expect(parseVideoProbe(JSON.stringify({ _type: 'playlist', entries: [] }))).toBeNull()
    expect(parseVideoProbe(JSON.stringify({ ext: 'mp4' }))).toBeNull()
    expect(parseVideoProbe('not json')).toBeNull()
  })
})

describe('parseRuntimeVersion', () => {
  it('extracts the semver from node/deno/bun version output', () => {
    expect(parseRuntimeVersion('v24.20.0')).toEqual([24, 20, 0])
    expect(parseRuntimeVersion('deno 2.9.7 (stable, release, x86_64-pc-windows-msvc)\nv8 14.0\ntypescript 5.9')).toEqual([2, 9, 7])
    expect(parseRuntimeVersion('1.2.11')).toEqual([1, 2, 11])
  })
  it('returns null when no version is present', () => {
    expect(parseRuntimeVersion('command not found')).toBeNull()
    expect(parseRuntimeVersion('')).toBeNull()
  })
})

describe('isRuntimeVersionSupported', () => {
  it('enforces the yt-dlp/ejs version floors', () => {
    // Electron 33 内嵌的 Node 20 低于门槛，会被 yt-dlp 判为 unsupported
    expect(isRuntimeVersionSupported('node', [20, 18, 3])).toBe(false)
    expect(isRuntimeVersionSupported('node', [21, 7, 0])).toBe(false)
    expect(isRuntimeVersionSupported('node', [22, 0, 0])).toBe(true)
    expect(isRuntimeVersionSupported('deno', [2, 2, 9])).toBe(false)
    expect(isRuntimeVersionSupported('deno', [2, 3, 0])).toBe(true)
  })
  it('rejects unknown runtimes and bun outside its supported range', () => {
    expect(isRuntimeVersionSupported('quickjs', [1, 0, 0])).toBe(false)
    expect(isRuntimeVersionSupported('node', null)).toBe(false)
    expect(isRuntimeVersionSupported('bun', [1, 2, 10])).toBe(false)
    expect(isRuntimeVersionSupported('bun', [1, 2, 11])).toBe(true)
    expect(isRuntimeVersionSupported('bun', [1, 3, 15])).toBe(false)
  })
})

describe('jsRuntimeArg', () => {
  it('returns undefined without a runtime', () => {
    expect(jsRuntimeArg(null)).toBeUndefined()
    expect(jsRuntimeArg(undefined)).toBeUndefined()
  })
  it('passes bare PATH-resolved names through', () => {
    expect(jsRuntimeArg({ name: 'deno', path: 'deno' })).toBe('deno')
  })
  it('prefixes the runtime name when a path is present', () => {
    expect(jsRuntimeArg({ name: 'node', path: 'C:\\Program Files\\nodejs\\node.exe' })).toBe('node:C:\\Program Files\\nodejs\\node.exe')
    expect(jsRuntimeArg({ name: 'deno', path: '/usr/local/bin/deno' })).toBe('deno:/usr/local/bin/deno')
  })
})

describe('videoFormat', () => {
  it('prefers same-container pairs without capping quality at h264/1080p', () => {
    const format = videoFormat(true)
    expect(format).toBe('bv*[ext=mp4]+ba[ext=m4a]/bv*[ext=webm]+ba[ext=webm]/bv*+ba/b')
    // 强制 avc1 会把画质卡在 1080p（4K 只有 vp9/av01 提供）
    expect(format).not.toContain('avc1')
  })
  it('falls back to a pre-merged single file without ffmpeg', () => {
    expect(videoFormat(false)).toBe('b[ext=mp4]/b')
  })
})

describe('decodeLine', () => {
  it('passes clean utf-8 lines through', () => {
    expect(decodeLine(Buffer.from('C:\\dir\\video.mp4', 'utf8'))).toBe('C:\\dir\\video.mp4')
    expect(decodeLine(Buffer.from('[download] 100% of 1.00MiB', 'utf8'))).toBe('[download] 100% of 1.00MiB')
  })
  it('recovers gbk-encoded paths that utf-8 decoding would corrupt', () => {
    // yt-dlp 在 Windows 管道下按系统 locale（GBK）输出含全角字符的路径（字节序列由 python gbk 编码生成）
    const gbkLine = Buffer.from('433a5ccfc2d4d85c43617261204d656e79757375692023313020a3fc2057494c534f4e2e6d7034', 'hex')
    expect(decodeLine(gbkLine)).toBe('C:\\下载\\Cara Menyusui #10 ｜ WILSON.mp4')
  })
  it('returns the utf-8 replacement form when the bytes are neither encoding', () => {
    const broken = Buffer.from([0xc3, 0x28]) // 非法 UTF-8 且非合法 GBK 序列
    expect(decodeLine(broken)).toContain('\ufffd')
  })
})
