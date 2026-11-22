// 智能合集纯逻辑：规则匹配与 ID 约定，供库视图与主进程共用（不碰 DOM，可穷举单测）。
import type { SmartCollectionRules } from '../types'

// 选中态约定：activeCollectionId 里智能合集带 smart: 前缀，与手动合集 id（uuid）区分
const SMART_PREFIX = 'smart:'
export const smartCollectionKey = (id: string) => `${SMART_PREFIX}${id}`
export const isSmartCollectionId = (id: string): boolean => id.startsWith(SMART_PREFIX)

export interface SmartMatchContext {
  watchPercent: number      // 0-100（主播放文件的观看进度）
  rating: number            // 0-5（无评分 = 0）
  addedAt: number           // 任务/本地条目的加入时间；缺省视为很久以前
  kind?: 'video' | 'audio'  // 任务：含视频流 → video，否则有音频流 → audio；本地引用按自身类型
  now: number               // 当前时间（注入便于单测）
}

// 创建时至少一条规则：空规则的动态合集与「全部」无差别，不允许
export function hasSmartRule(rules: SmartCollectionRules): boolean {
  return rules.kind !== undefined || rules.watchState !== undefined || rules.minRating !== undefined || rules.addedWithinDays !== undefined
}

// 全部已声明规则须同时满足（AND）；未声明的规则不参与过滤
export function matchesSmartCollection(rules: SmartCollectionRules, ctx: SmartMatchContext): boolean {
  if (rules.kind && ctx.kind !== rules.kind) return false
  if (rules.minRating !== undefined && ctx.rating < rules.minRating) return false
  if (rules.watchState === 'unfinished' && !(ctx.watchPercent > 0 && ctx.watchPercent < 95)) return false
  if (rules.addedWithinDays !== undefined && (!ctx.addedAt || ctx.now - ctx.addedAt > rules.addedWithinDays * 86400000)) return false
  return true
}
