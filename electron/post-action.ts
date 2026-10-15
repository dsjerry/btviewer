// 下载完成后的动作（C3）：打开目录/文件、退出、关机、休眠。
// 这里只做「该不该做 + 打开哪个路径 + 执行什么命令」的纯决策，真正落地在 main.ts（shell/Notification）。
import type { PostAction } from '../src/types'

export interface CompletedTaskInfo {
  name: string
  saveDir: string
  paths: Array<{ path: string; kind: 'video' | 'audio' | 'subtitle' | 'other' }>
}

export interface PostActionRequest {
  action: PostAction
  kind: 'openDir' | 'openFile' | 'quit' | 'power'
  // openDir/openFile 的目标路径
  path?: string
  // power 动作对应的命令与参数
  command?: string
  args?: string[]
  // 面向用户的说明（通知正文）
  message: string
}

// 只在「队列里没有别的任务还在下载」时才执行，避免边下边关机/退出；
// 做种中的任务不算仍在下载（开启做种策略后它们会长期停留在 seeding）
export function shouldRunPostAction(action: PostAction, pendingTasks: number): boolean {
  if (action === 'none') return false
  return pendingTasks <= 0
}

// 优先打开可播放的媒体文件；没有媒体文件时退回目录
export function resolveOpenTarget(action: PostAction, task: CompletedTaskInfo | null): { path: string; kind: 'openDir' | 'openFile' } | null {
  if (!task) return null
  if (action !== 'openDir' && action !== 'openFile') return null
  if (action === 'openDir') return task.saveDir ? { path: task.saveDir, kind: 'openDir' } : null
  const media = task.paths.find((item) => item.kind === 'video') || task.paths.find((item) => item.kind === 'audio')
  const target = media?.path || task.paths[0]?.path
  if (target) return { path: target, kind: 'openFile' }
  return task.saveDir ? { path: task.saveDir, kind: 'openDir' } : null
}

// 关机/休眠命令；预留 60 秒倒计时，Windows 可用 shutdown /a 取消
export function powerCommand(action: PostAction, platform: NodeJS.Platform): { command: string; args: string[] } | null {
  if (action === 'shutdown') {
    if (platform === 'win32') return { command: 'shutdown', args: ['/s', '/t', '60'] }
    if (platform === 'darwin') return { command: 'osascript', args: ['-e', 'tell app "System Events" to shut down'] }
    return { command: 'systemctl', args: ['poweroff'] }
  }
  if (action === 'sleep') {
    if (platform === 'win32') return { command: 'rundll32.exe', args: ['powrprof.dll,SetSuspendState', '0,1,0'] }
    if (platform === 'darwin') return { command: 'pmset', args: ['sleepnow'] }
    return { command: 'systemctl', args: ['suspend'] }
  }
  return null
}

export const POST_ACTION_LABELS: Record<PostAction, string> = {
  none: '不执行任何操作',
  openDir: '打开文件所在目录',
  openFile: '打开下载的文件',
  quit: '退出 BTViewer',
  shutdown: '关机（60 秒倒计时，可取消）',
  sleep: '睡眠'
}

// 组装成可执行请求；不做任何副作用，便于单测
export function planPostAction(action: PostAction, task: CompletedTaskInfo | null, pendingTasks: number, platform: NodeJS.Platform): PostActionRequest | null {
  if (!shouldRunPostAction(action, pendingTasks)) return null
  if (action === 'quit') return { action, kind: 'quit', message: '队列已全部完成，正在退出 BTViewer' }
  if (action === 'shutdown' || action === 'sleep') {
    const command = powerCommand(action, platform)
    if (!command) return null
    const isShutdown = action === 'shutdown'
    const cancel = platform === 'win32' && isShutdown ? '；如需取消请在终端运行 shutdown /a' : ''
    return { action, kind: 'power', command: command.command, args: command.args, message: isShutdown ? `队列已全部完成，60 秒后关机${cancel}` : '队列已全部完成，正在进入睡眠' }
  }
  const target = resolveOpenTarget(action, task)
  if (!target) return null
  return { action, kind: target.kind, path: target.path, message: target.kind === 'openDir' ? `已打开所在目录：${target.path}` : `已打开文件：${target.path}` }
}
