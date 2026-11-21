// 启动参数 / 二次启动 / 协议回调里带进来的任务输入（C1）。
// 纯函数 + 可注入的 exists，便于单测覆盖各种命令行形态。
import { existsSync } from 'fs'

export const MAX_LAUNCH_INPUTS = 20
const TASK_FILE_RE = /\.(torrent|metalink|meta4)$/i
// Finder「打开方式」/ 双击带进来的媒体文件（本地导入播放，不走任务解析）。
// 与 torrent-engine 的 VIDEO_EXTENSIONS/AUDIO_EXTENSIONS 保持一致——主进程 toLocalMediaEntry
// 会再用 getFileType 校验一遍，这里多认了会在导入时报「不支持的本地媒体格式」
export const MEDIA_FILE_RE = /\.(mp4|mkv|avi|mov|webm|flv|wmv|m4v|ts|rmvb|mp3|flac|wav|aac|ogg|m4a|wma)$/i

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

// 与任务输入同一套过滤规则，只挑媒体文件（同样要求文件确实存在）
export function collectMediaLaunchInputs(argv: string[], exists: (path: string) => boolean = existsSync): string[] {
  const inputs: string[] = []
  for (const raw of argv) {
    const value = String(raw || '').trim()
    if (!value || value.startsWith('-') || isMagnet(value)) continue
    if (MEDIA_FILE_RE.test(value) && exists(value)) {
      if (!inputs.includes(value)) inputs.push(value)
    }
    if (inputs.length >= MAX_LAUNCH_INPUTS) break
  }
  return inputs
}
