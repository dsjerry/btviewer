// 安装器里「不依赖 electron 运行时」的纯逻辑：便于单测，也避免 installer 的权限处理散落各处。
// 只依赖类型：运行时不会把 electron 拉进来（单测直接引用本文件即可）
import type { YtdlpCheck } from '../src/services/ipc'

type BinaryName = 'yt-dlp' | 'ffmpeg' | 'deno'

// macOS/Linux 上下载或复制的二进制会丢掉可执行位，必须显式补回（否则 spawn 报 EACCES）。
// Windows 没有可执行位概念；chmod 失败（只读卷等）不应让安装整体失败。
export function ensureExecutable(path: string, opts: { platform?: NodeJS.Platform; chmod?: (path: string, mode: number) => void } = {}) {
  const platform = opts.platform ?? process.platform
  if (platform === 'win32') return
  const chmod = opts.chmod
  if (!chmod) return
  try { chmod(path, 0o755) } catch { /* 由后续的可执行性检测兜底报错 */ }
}

// 某个平台确实没有官方构建时的提示：面向普通用户，不提 pip/brew 之类的开发者命令
export function denyAssetMessage(binary: BinaryName, target: { platform: string; arch: string }): string {
  const label = target.platform === 'darwin' ? 'macOS' : target.platform === 'win32' ? 'Windows' : '当前系统'
  return `暂无可用的 ${binary} 官方构建（${label} ${target.arch}）：可以继续使用系统里已安装的版本，或在「设置 → 视频站点解析」中手动指定可执行文件路径`
}

// 安装完成后合并检测结果：刚装好的二进制应当立刻显示为「可用」，而不是要求用户再点一次检测
export function mergeYtdlpStatus(current: YtdlpCheck, installed: { path?: string; ffmpeg?: string | null }): YtdlpCheck {
  const path = current.available && current.path ? current.path : (installed.path || current.path)
  const ffmpegAvailable = current.ffmpegAvailable || !!installed.ffmpeg
  return { ...current, available: !!path, path, ffmpegAvailable }
}
