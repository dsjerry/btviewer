import { appendFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
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
