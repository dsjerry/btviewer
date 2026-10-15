// 一键诊断（C5）：把「出问题时最需要的信息」拼成一段可复制的文本。
// 纯函数：主进程负责收集数据，格式化与脱敏都在这里，便于单测。
import type { EngineNetworkStatus } from '../src/types'

export interface DiagnosticInput {
  appVersion: string
  versions: { electron: string; chrome: string; node: string }
  platform: string
  arch: string
  packaged: boolean
  // 用户目录（app.getPath('home')）：诊断信息里替换成 ~，避免带出本机用户名
  home?: string
  settings: {
    downloadDir?: string
    maxConcurrentDownloads?: number
    speedLimit?: string
    httpSplit?: number
    proxy?: string
    trackers?: string
    ytdlpPath?: string
    ytdlpBrowser?: string
    seedMode?: string
    listenPort?: string
    streamPriority?: boolean
    autoRetry?: boolean
  }
  network: EngineNetworkStatus | null
  tasks: { total: number; downloading: number; connecting: number; parsing: number; seeding: number; paused: number; error: number }
  binaries: { ffmpeg: string | null; ytdlp: string | null; jsRuntime: string | null }
  recentErrors: string[]
}

// 代理可能带账号密码，诊断信息里必须脱敏
export function maskProxy(proxy: string | undefined): string {
  if (!proxy) return '未设置'
  return proxy.replace(/\/\/[^/@\s]+@/, '//***@')
}

// 用户目录替换成 ~，避免把本机用户名带进反馈内容
export function maskHomePaths(text: string, home?: string): string {
  const root = home || process.env.USERPROFILE || process.env.HOME || ''
  if (!root) return text
  return text.split(root).join('~')
}

function line(key: string, value: string | number | boolean | undefined) {
  const text = value === undefined || value === '' ? '未设置' : String(value)
  return `  ${key.padEnd(14, ' ')}${text}`
}

export function buildDiagnostics(input: DiagnosticInput): string {
  const { settings, network, tasks, binaries } = input
  const hide = (text: string) => maskHomePaths(text, input.home)
  const trackerCount = (settings.trackers || '').split(/[\s,]+/).filter(Boolean).length
  const sections = [
    'BTViewer 诊断信息',
    `生成时间：${new Date().toISOString()}`,
    '',
    '[版本与环境]',
    line('应用版本', input.appVersion),
    line('运行方式', input.packaged ? '打包版' : '开发模式'),
    line('Electron', input.versions.electron),
    line('Chromium', input.versions.chrome),
    line('Node', input.versions.node),
    line('系统', `${input.platform} ${input.arch}`),
    '',
    '[外挂依赖]',
    line('ffmpeg', binaries.ffmpeg ? hide(binaries.ffmpeg) : '未找到（兼容播放/封面提取不可用）'),
    line('yt-dlp', binaries.ytdlp ? hide(binaries.ytdlp) : '未找到（视频站点解析不可用）'),
    line('JS 运行时', binaries.jsRuntime || '未找到（YouTube 高画质解析受限）'),
    '',
    '[下载引擎]',
    line('状态', network ? (network.running ? '运行中' : '未启动') : '未知'),
    line('aria2 版本', network?.version || '未知'),
    line('监听端口', network?.actualPort || settings.listenPort || 'aria2 默认'),
    line('DHT/PEX/LPD', network ? `${network.enableDht ? '开' : '关'}/${network.enablePex ? '开' : '关'}/${network.enableLpd ? '开' : '关'}` : '未知'),
    line('传输加密', network?.btEncryption === 'require' ? '强制' : '自动'),
    line('待重启生效', network?.restartRequired ? '是' : '否'),
    '',
    '[下载设置]',
    line('下载目录', hide(settings.downloadDir || '默认')),
    line('全局限速', settings.speedLimit && settings.speedLimit !== '0' ? settings.speedLimit : '不限速'),
    line('同时下载数', settings.maxConcurrentDownloads ?? '默认'),
    line('直链分片数', settings.httpSplit ?? '默认'),
    line('代理', maskProxy(settings.proxy)),
    line('自定义 Tracker', trackerCount ? `${trackerCount} 个` : '内置公共 Tracker'),
    line('做种策略', settings.seedMode === 'ratio' ? '按分享率' : settings.seedMode === 'time' ? '按时长' : '下完即停'),
    line('边下边播优化', settings.streamPriority === false ? '关' : '开'),
    line('失败自动重试', settings.autoRetry === false ? '关' : '开'),
    line('yt-dlp 路径', hide(settings.ytdlpPath || 'PATH 中的 yt-dlp')),
    line('Cookies 浏览器', settings.ytdlpBrowser || '不使用'),
    '',
    '[任务概况]',
    line('任务总数', tasks.total),
    line('下载中/连接中', `${tasks.downloading}/${tasks.connecting}`),
    line('解析中', tasks.parsing),
    line('已完成', tasks.seeding),
    line('已暂停', tasks.paused),
    line('出错', tasks.error)
  ]
  if (input.recentErrors.length) {
    sections.push('', '[最近错误]', ...input.recentErrors.map((text) => `  ${hide(text)}`))
  }
  return `${sections.join('\n')}\n`
}
