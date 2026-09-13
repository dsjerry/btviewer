import { readFileSync, renameSync, writeFileSync } from 'fs'

// 读取 JSON 文件；文件缺失或内容损坏时返回 fallback
export function readJson<T>(path: string, fallback: T): T {
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return fallback }
}

// 原子写：先写 .tmp 再 rename 替换，进程中途被杀也不会留下写了一半的原文件
export function writeJsonAtomic(path: string, data: unknown, space?: number) {
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(data, null, space))
  renameSync(tmp, path)
}
