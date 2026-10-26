// 设置页的「字段级提交」规则：每个输入框在失焦时单独提交，不再依赖底部的「保存设置」按钮。
// 这里只做纯决策（该提交什么、是否合法、是否需要提示重启），副作用交给组件。
import type { AppSettings } from '../types'
import { validateListenPort, validateRetries, validateSeedMinutes, validateSeedRatio, validateSizeLimit } from './validate'

// 代理格式：http(s)://host:port 或 socks4/5://host:port；留空表示不使用
const PROXY_RE = /^(https?|socks4a?|socks5h?):\/\/[^\s]+$/i

export function validateProxy(value: string): string {
  const proxy = value.trim()
  if (!proxy) return ''
  return PROXY_RE.test(proxy) ? '' : '格式无效，示例：http://127.0.0.1:7890'
}

export function validateTrackers(value: string): string {
  const list = value.split(/[\s,]+/).filter(Boolean)
  if (!list.length) return ''
  const invalid = list.find((item) => !/^(udp|https?|wss?):\/\//i.test(item))
  return invalid ? `无效 tracker（需以 udp://、http(s):// 或 ws(s):// 开头）：${invalid.slice(0, 60)}` : ''
}

// 可编辑的文本/数字字段；下拉与复选框走即时提交，不在这里
export type EditableField =
  | 'trackers' | 'proxy' | 'speedLimit' | 'listenPort' | 'ytdlpPath' | 'ytdlpBrowser'
  | 'maxConcurrentDownloads' | 'httpSplit' | 'seedRatio' | 'seedMinutes' | 'maxRetries'

// 字段 → 校验器；返回空串表示可以提交
export function validateField(field: EditableField, value: string, state: { seedMode?: string; autoRetry?: boolean }): string {
  switch (field) {
    case 'trackers': return validateTrackers(value)
    case 'proxy': return validateProxy(value)
    case 'speedLimit': return validateSizeLimit(value)
    case 'listenPort': return validateListenPort(value)
    case 'seedRatio': return state.seedMode === 'ratio' ? validateSeedRatio(Number(value)) : ''
    case 'seedMinutes': return state.seedMode === 'time' ? validateSeedMinutes(Number(value)) : ''
    case 'maxRetries': return state.autoRetry === false ? '' : validateRetries(Number(value))
    // 纯文本与 1-16 的整数钳制在归一化里处理，没有额外校验
    default: return ''
  }
}

// 把输入框里的原始文本变成要提交给主进程的 patch；null 表示值没变，不必提交
export function fieldPatch(field: EditableField, raw: string, current: AppSettings | null): Partial<AppSettings> | null {
  const value = raw.trim()
  switch (field) {
    case 'trackers': return patchIfChanged('trackers', value, current?.trackers || '')
    case 'proxy': return patchIfChanged('proxy', value, current?.proxy || '')
    case 'ytdlpPath': return patchIfChanged('ytdlpPath', value, current?.ytdlpPath || '')
    case 'ytdlpBrowser': return patchIfChanged('ytdlpBrowser', value, current?.ytdlpBrowser || '')
    case 'listenPort': return patchIfChanged('listenPort', value, current?.listenPort || '')
    // 限速：主进程把 '0' 当作不限速，空串归一化为 '0'
    case 'speedLimit': return patchIfChanged('speedLimit', value || '0', current?.speedLimit || '0')
    case 'maxConcurrentDownloads': {
      const number = clampInt(value, 1, 10, current?.maxConcurrentDownloads ?? 5)
      return patchIfChanged('maxConcurrentDownloads', number, current?.maxConcurrentDownloads ?? 5)
    }
    case 'httpSplit': {
      const number = clampInt(value, 1, 16, current?.httpSplit ?? 8)
      return patchIfChanged('httpSplit', number, current?.httpSplit ?? 8)
    }
    case 'seedRatio': {
      // 空串不能当成 0（Number('') === 0），否则会静默把分享率改成 0
      if (!value) return null
      const number = Number(value)
      if (!Number.isFinite(number)) return null
      return patchIfChanged('seedRatio', number, current?.seedRatio ?? 1)
    }
    case 'seedMinutes': {
      if (!value) return null
      const number = Number(value)
      if (!Number.isFinite(number)) return null
      return patchIfChanged('seedMinutes', number, current?.seedMinutes ?? 60)
    }
    case 'maxRetries': {
      const number = clampInt(value, 0, 10, current?.maxRetries ?? 3)
      return patchIfChanged('maxRetries', number, current?.maxRetries ?? 3)
    }
    default: return null
  }
}

function patchIfChanged<K extends keyof AppSettings>(key: K, next: AppSettings[K], current: AppSettings[K] | undefined): Partial<AppSettings> | null {
  return next === current ? null : { [key]: next } as Partial<AppSettings>
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  // 空串的 Number() 是 0，会被钳到 min，产生意外的「最小值」写入；这里按无效处理
  if (!raw.trim()) return fallback
  const number = Math.floor(Number(raw))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

// 这些是 aria2 的命令行参数：运行中改不了，提交后要提示「重启引擎生效」
const RESTART_FIELDS: ReadonlySet<EditableField> = new Set(['listenPort'])

export function requiresEngineRestart(field: EditableField): boolean {
  return RESTART_FIELDS.has(field)
}
