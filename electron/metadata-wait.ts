// 磁力链接「获取元数据（文件列表）」阶段的判定逻辑。
// 这段以前写成 30 秒硬超时 + 一句“下载任务正在解析，请稍候”，导致冷门种子被误判为解析失败。
// 现在拆成纯函数：什么时候算完成、什么时候该提示“还在努力”、什么时候才算真的失败。

export interface MetadataSnapshot {
  // aria2 的空壳任务（pause-metadata）帧：其文件列表只是 [METADATA] 占位
  isPlaceholder: boolean
  hasFiles: boolean
  // aria2 拿到的 bt 名称（通常在元数据到手后出现）
  hasName: boolean
  followedBy: boolean
  error?: string
  connections: number
}

export type MetadataPhase =
  // 文件列表已就绪（真实文件，不是占位）
  | 'ready'
  // 元数据到手但后续任务尚未接管
  | 'settling'
  // 仍在等待：有 peer 在连或刚开始等
  | 'waiting'
  // 等太久且完全没有 peer：给出可操作提示而不是直接失败
  | 'stalled'
  | 'error'

export interface MetadataDecision {
  phase: MetadataPhase
  // 给用户看的说明（UI 直接展示，避免英文界面出现中文）
  messageKey: string
  // 是否应结束等待循环
  done: boolean
}

// 等待阈值：前 45 秒给出“正在连接节点”，之后转为“较慢，建议保持窗口开启”
export const METADATA_SLOW_AFTER_MS = 45_000
// 上限：2 分钟。超过后不再阻塞添加流程，任务仍留在列表里继续尝试
export const METADATA_GIVE_UP_MS = 120_000

export function decideMetadataPhase(
  snapshot: MetadataSnapshot,
  elapsedMs: number,
  options: { slowAfterMs?: number; giveUpAfterMs?: number } = {}
): MetadataDecision {
  const slowAfter = options.slowAfterMs ?? METADATA_SLOW_AFTER_MS
  const giveUpAfter = options.giveUpAfterMs ?? METADATA_GIVE_UP_MS

  if (snapshot.error) return { phase: 'error', messageKey: 'metadata.error', done: true }
  if (snapshot.hasFiles && !snapshot.isPlaceholder && !snapshot.followedBy) return { phase: 'ready', messageKey: 'metadata.ready', done: true }
  // 元数据已到、后续任务马上接管：短暂停留以拿到真实文件列表
  if (snapshot.hasName && !snapshot.followedBy) return { phase: 'settling', messageKey: 'metadata.settling', done: false }

  if (elapsedMs >= giveUpAfter) return { phase: 'stalled', messageKey: 'metadata.stalled', done: true }
  if (elapsedMs >= slowAfter && snapshot.connections === 0) return { phase: 'stalled', messageKey: 'metadata.noPeers', done: false }
  return { phase: 'waiting', messageKey: 'metadata.waiting', done: false }
}
