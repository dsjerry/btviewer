// 启动参数 / 二次启动 / 协议回调里带进来的任务输入（C1）。
// 纯函数 + 可注入的 exists，便于单测覆盖各种命令行形态。
import { existsSync } from 'fs'

export const MAX_LAUNCH_INPUTS = 20
const TASK_FILE_RE = /\.(torrent|metalink|meta4)$/i

export function isMagnet(value: string) {
  return /^magnet:\?/i.test(value.trim())
}

// 只保留「磁力链接」与「确实存在的种子/元链接文件」；跳过开关、可执行文件、入口脚本与普通目录
export function collectLaunchInputs(argv: string[], exists: (path: string) => boolean = existsSync): string[] {
  const inputs: string[] = []
  for (const raw of argv) {
    const value = String(raw || '').trim()
    if (!value || value.startsWith('-')) continue
    if (isMagnet(value)) {
      if (!inputs.includes(value)) inputs.push(value)
    } else if (TASK_FILE_RE.test(value) && exists(value)) {
      if (!inputs.includes(value)) inputs.push(value)
    }
    if (inputs.length >= MAX_LAUNCH_INPUTS) break
  }
  return inputs
}
