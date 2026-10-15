export interface TorrentFileInfo {
  name: string
  path: string
  size: number
  // 已下载字节数（任务进行中会随状态刷新增长），用于单文件进度展示
  completed: number
  type: 'video' | 'audio' | 'subtitle' | 'other'
}

export type TorrentStatusType = 'parsing' | 'connecting' | 'downloading' | 'seeding' | 'paused' | 'error'

// 任务协议类型：bt（磁力/torrent）、http/ftp（直链）、metalink、video（yt-dlp 视频站点）
export type TaskProtocol = 'bt' | 'http' | 'ftp' | 'metalink' | 'video'

export interface TorrentStatus {
  infoHash: string
  name: string
  magnetURI: string
  progress: number
  downloadSpeed: number
  uploadSpeed: number
  downloaded: number
  totalSize: number
  numPeers: number
  timeRemaining: number
  status: TorrentStatusType
  files: TorrentFileInfo[]
  // 累计上传字节数（用于分享率）
  uploaded: number
  // 任务保存目录
  saveDir: string
  // 任务协议；缺省视为 bt（兼容旧持久化数据）
  type?: TaskProtocol
  // 直链/视频任务的原始 URL（详情展示与复制）
  sourceUrl?: string
  error?: string
  // 排队位次（aria2 只对等待中的任务提供位置）；undefined 表示不是排队状态
  queuePosition?: number
  // 任务加入时间（毫秒）；用于媒体库「最近添加」排序，旧任务可能为空
  addedAt?: number
}

// 下载任务清单导出条目（tasks.json 的可读投影，用于备份与跨设备迁移）
export interface TaskListEntry {
  hash: string
  source: string
  type: TaskProtocol
  name: string
  done: boolean
  addedAt: number
}

// 清单导入结果
export interface TaskImportSummary {
  added: number
  skipped: number
  failed: number
  errors: string[]
}

// 下载完成后的动作（C3）：仅在队列全部下载完成时执行
export type PostAction = 'none' | 'openDir' | 'openFile' | 'quit' | 'shutdown' | 'sleep'

// 下载引擎全局统计（C2）：侧边栏与托盘展示实时上下行与任务数
export interface GlobalStat {
  downloadSpeed: number
  uploadSpeed: number
  numActive: number
  numWaiting: number
  numStopped: number
}

// 播放列表条目（B4）：同一部剧的集可能分散在多个任务里，因此条目自带任务身份
export interface PlaylistEntry {
  infoHash: string
  file: TorrentFileInfo
  torrentName: string
}

// 片头/片尾标记（B6）：按剧集键记忆，同剧各集共用
export interface SkipMarks {
  introEnd?: number
  outroStart?: number
}

// 兼容播放（B1）：方案与进度
export type CompatMode = 'copy' | 'audio' | 'video'
export interface CompatPlanResult {
  available: boolean
  mode: CompatMode
  reason: string
  durationSeconds: number
  sizeBytes: number
  // 多音轨（Chromium 不支持切轨，只有走兼容转码时才能选择保留哪条）
  audioTracks: CompatAudioTrack[]
}
export interface CompatAudioTrack {
  index: number
  codec: string
  language: string
  title: string
  channels: number
}
export interface CompatProgressEvent {
  id: string
  percent: number
  phase: 'running' | 'done' | 'error'
  mode?: CompatMode
  message?: string
}
export interface CompatStartResult {
  id: string
  mode: CompatMode
  container: 'mp4' | 'webm'
  reason: string
  durationSeconds: number
  outputSize: number
}

// 批量添加结果（多链接粘贴 / 多文件拖放）
export interface BatchAddSummary {
  added: number
  bt: number
  failed: number
  errors: string[]
}

// 单个 BT 节点（aria2.getPeers 映射而来，字号已转成数字）
export interface TaskPeer {
  ip: string
  port: number
  downloadSpeed: number
  uploadSpeed: number
  seeder: boolean
  choked: boolean
}

// 下载引擎的网络状态（设置页「网络与连通性」卡片）
export interface EngineNetworkStatus {
  // 用户配置的监听端口；空 = aria2 默认范围
  listenPort: string
  enableDht: boolean
  enablePex: boolean
  enableLpd: boolean
  btEncryption: 'auto' | 'require'
  // 运行中修改了需要重启才生效的选项
  restartRequired: boolean
  running: boolean
  version: string
  // aria2 实际使用的端口
  actualPort: string
}

export type ThemeMode = 'light' | 'dark' | 'system'

// 界面语言（C6）：默认中文，可切英文
export type Language = 'zh' | 'en'

// RSS 订阅条目（主进程 feeds.json 的渲染层视图）
export interface FeedItem { guid: string; title: string; magnet: string; torrentUrl: string; pubDate?: string; downloaded?: boolean }

export interface Feed {
  id: string
  name: string
  url: string
  keywords: string[]
  autoDownload: boolean
  groupBySeason: boolean
  enabled: boolean
  lastCheckedAt?: number
  lastError?: string
  items: FeedItem[]
  seenGuids: string[]
}

export interface AppSettings {
  downloadDir?: string
  trackers?: string
  maxConcurrentDownloads?: number
  speedLimit?: string
  // 直链下载：每服务器最大连接数（1-16，缺省 8）
  httpSplit?: number
  // yt-dlp 可执行文件路径；缺省从 PATH 查找
  ytdlpPath?: string
  // yt-dlp 的 cookies 来源浏览器（登录 YouTube 后可解锁高画质）；空则不带 cookies
  ytdlpBrowser?: string
  // 代理地址（http/socks4/socks5），用于直链与视频站点下载；BT/DHT 不走代理
  proxy?: string
  logDir?: string
  theme?: ThemeMode
  // 界面语言（缺省中文）
  language?: Language
  // 关闭窗口时是否隐藏到托盘；缺省视为开启
  closeToTray?: boolean
  // 开机自启（主进程以系统登录项状态回显）
  launchOnStartup?: boolean
  // 下载完成桌面通知；缺省视为开启
  notifyOnComplete?: boolean
  // 注册为系统默认磁力链接处理程序（默认关闭：避免抢掉其它 BT 客户端的关联）
  registerMagnet?: boolean
  // 下载完成后执行的动作（缺省不执行）
  postAction?: PostAction
  // 监听剪贴板：复制到磁力/直链时在应用内提示一键添加（默认关闭，且不会自动开始下载）
  clipboardWatch?: boolean
  // ── 网络与连通性（aria2 命令行选项，改动需重启下载引擎生效）
  // BT 监听端口；空则使用 aria2 默认范围（6881-6999）
  listenPort?: string
  enableDht?: boolean
  enablePex?: boolean
  enableLpd?: boolean
  // BT 传输加密：auto 允许明文（兼容性最好，默认）；require 强制加密
  btEncryption?: 'auto' | 'require'
  // ── 做种策略（对之后添加的任务生效）
  seedMode?: 'off' | 'ratio' | 'time'
  seedRatio?: number
  seedMinutes?: number
  // 边下边播优化：为 BT 任务预置 head/tail 分片优先，为媒体直链启用顺序分片
  streamPriority?: boolean
  // 失败自动重试与最大次数
  autoRetry?: boolean
  maxRetries?: number
}

// 单个媒体文件的观看进度，用于续播
export interface WatchProgress {
  position: number
  duration: number
  updatedAt: number
}

export interface IPCResult<T = undefined> {
  success: boolean
  data?: T
  error?: string
  canceled?: boolean
}

export type IPCChannel =
  | 'torrent:add'
  | 'torrent:remove'
  | 'torrent:pause'
  | 'torrent:resume'
  | 'torrent:all-status'
  | 'torrent:get-stream-url'
  | 'ytdlp:check'
  | 'ytdlp:install'
  | 'ytdlp:update'
  | 'ffmpeg:install'
  | 'dialog:open-file'
