import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const LOG_DIR = () => join(app.getPath('userData'), 'logs')
const MAX_LOG_FILES = 5

function write(level: string, tag: string, message: string) {
  try {
    mkdirSync(LOG_DIR(), { recursive: true })
    const line = `[${new Date().toISOString()}] [${level}] [${tag}] ${message}\n`
    appendFileSync(join(LOG_DIR(), `btviewer-${new Date().toISOString().slice(0, 10)}.log`), line)
  } catch { /* 日志写入失败不影响主流程 */ }
}

export const logger = {
  logDir: LOG_DIR,
  info: (tag: string, message: string) => { write('INFO', tag, message); console.log(`[${tag}]`, message) },
  warn: (tag: string, message: string) => { write('WARN', tag, message); console.warn(`[${tag}]`, message) },
  error: (tag: string, message: string) => { write('ERROR', tag, message); console.error(`[${tag}]`, message) },
  // 只保留最近 keep 份日志文件
  cleanup(keep = MAX_LOG_FILES) {
    try {
      const dir = LOG_DIR()
      if (!existsSync(dir)) return
      const files = readdirSync(dir).filter((f) => f.startsWith('btviewer-') && f.endsWith('.log')).sort()
      while (files.length > keep) unlinkSync(join(dir, files.shift()!))
    } catch { /* ignore */ }
  }
}

// ── 日志读取（C5）：应用内日志页用，最新的排在前面 ──────────────────
export interface LogFileInfo { name: string; size: number; modifiedAt: number }
export interface LogEntry { time: string; level: string; tag: string; message: string; raw: string }

const LINE_RE = /^\[([^\]]+)\]\s*\[(\w+)\]\s*\[([^\]]*)\]\s*([\s\S]*)$/

// 解析一行日志；解析不出来（多行堆栈、历史格式）也保留原文，方便排查
export function parseLogLine(line: string): LogEntry | null {
  const raw = line.replace(/\r$/, '')
  if (!raw.trim()) return null
  const match = LINE_RE.exec(raw)
  if (!match) return { time: '', level: 'RAW', tag: '', message: raw, raw }
  return { time: match[1], level: match[2].toUpperCase(), tag: match[3], message: match[4], raw }
}

export function listLogFiles(): LogFileInfo[] {
  try {
    const dir = LOG_DIR()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((name) => name.startsWith('btviewer-') && name.endsWith('.log'))
      .map((name) => {
        const info = statSync(join(dir, name))
        return { name, size: info.size, modifiedAt: info.mtimeMs }
      })
      .sort((a, b) => b.modifiedAt - a.modifiedAt)
  } catch { return [] }
}

// 只读文件尾部：日志可能很大，按字节截断后再按行切分，避免整文件读入内存
export function readLogTail(maxLines = 400, fileName?: string): { name: string; entries: LogEntry[] } {
  const files = listLogFiles()
  const target = (fileName && files.find((file) => file.name === fileName)) || files[0]
  if (!target) return { name: '', entries: [] }
  const path = join(LOG_DIR(), target.name)
  const limitBytes = 256 * 1024
  let text: string
  try {
    const size = statSync(path).size
    const start = Math.max(0, size - limitBytes)
    const length = size - start
    if (length <= 0) return { name: target.name, entries: [] }
    const buffer = Buffer.alloc(length)
    const fd = openSync(path, 'r')
    try { readSync(fd, buffer, 0, length, start) } finally { closeSync(fd) }
    text = buffer.toString('utf8')
    // 从中间截断时首行可能是半个 UTF-8 字符/半行，丢掉
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
  } catch { return { name: target.name, entries: [] } }
  const lines = text.split('\n')
  const entries: LogEntry[] = []
  for (const line of lines) {
    const entry = parseLogLine(line)
    if (entry) entries.push(entry)
  }
  return { name: target.name, entries: entries.slice(-Math.max(1, Math.min(2000, maxLines))) }
}
