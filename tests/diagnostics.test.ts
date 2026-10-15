import { describe, expect, it } from 'vitest'
import { buildDiagnostics, maskHomePaths, maskProxy, type DiagnosticInput } from '../electron/diagnostics'

const base: DiagnosticInput = {
  appVersion: '1.0.0',
  versions: { electron: '33.4.11', chrome: '130.0.0.0', node: '20.18.3' },
  platform: 'win32',
  arch: 'x64',
  packaged: false,
  home: 'C:\\Users\\tester',
  settings: {
    downloadDir: 'C:\\Users\\tester\\Downloads',
    maxConcurrentDownloads: 5,
    speedLimit: '10M',
    httpSplit: 8,
    proxy: 'http://user:secret@127.0.0.1:7890',
    trackers: 'udp://a:1/announce,udp://b:2/announce',
    seedMode: 'time'
  },
  network: { listenPort: '6881', enableDht: true, enablePex: true, enableLpd: false, btEncryption: 'require', restartRequired: false, running: true, version: '1.37.0', actualPort: '6881' },
  tasks: { total: 3, downloading: 1, connecting: 0, parsing: 0, seeding: 1, paused: 1, error: 0 },
  binaries: { ffmpeg: 'C:\\Users\\tester\\AppData\\Roaming\\btviewer\\bin\\ffmpeg.exe', ytdlp: null, jsRuntime: 'deno 2.4.0' },
  recentErrors: ['[aria2] C:\\Users\\tester\\log 写入失败']
}

describe('maskProxy', () => {
  it('隐藏代理里的账号密码', () => {
    expect(maskProxy('http://user:secret@127.0.0.1:7890')).toBe('http://***@127.0.0.1:7890')
    expect(maskProxy('socks5://127.0.0.1:1080')).toBe('socks5://127.0.0.1:1080')
    expect(maskProxy('')).toBe('未设置')
    expect(maskProxy(undefined)).toBe('未设置')
  })
})

describe('maskHomePaths', () => {
  it('把用户目录替换成 ~', () => {
    expect(maskHomePaths('C:\\Users\\tester\\Downloads', 'C:\\Users\\tester')).toBe('~\\Downloads')
  })

  it('没有用户目录信息时原样返回', () => {
    expect(maskHomePaths('abc', '')).toBe('abc')
  })
})

describe('buildDiagnostics', () => {
  const text = buildDiagnostics(base)

  it('包含各分区与关键字段', () => {
    for (const marker of ['BTViewer 诊断信息', '[版本与环境]', '[外挂依赖]', '[下载引擎]', '[下载设置]', '[任务概况]', '[最近错误]']) {
      expect(text).toContain(marker)
    }
    expect(text).toContain('1.37.0')
    expect(text).toContain('开/开/关')
    expect(text).toContain('强制')
    expect(text).toContain('自定义 Tracker')
    expect(text).toContain('2 个')
    expect(text).toContain('下载中/连接中')
    expect(text).toContain('1/0')
  })

  it('脱敏：代理账号密码与用户目录都不外泄', () => {
    expect(text).not.toContain('secret')
    expect(text).toContain('http://***@127.0.0.1:7890')
    expect(text).not.toContain('tester')
  })

  it('缺失项显示未设置，缺 ffmpeg 时给出原因', () => {
    const minimal = buildDiagnostics({ ...base, settings: {}, network: null, binaries: { ffmpeg: null, ytdlp: null, jsRuntime: null }, recentErrors: [] })
    expect(minimal).toContain('未找到（兼容播放/封面提取不可用）')
    expect(minimal).toContain('不限速')
    expect(minimal).toContain('未知')
    expect(minimal).not.toContain('[最近错误]')
  })

  it('限速为 0 视为不限速', () => {
    const unlimited = buildDiagnostics({ ...base, settings: { ...base.settings, speedLimit: '0' } })
    expect(unlimited).toContain('不限速')
  })
})
