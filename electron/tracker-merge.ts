// 磁力链接的 tracker 合并规则。
// aria2 的 addUri 里传 bt-tracker 会「整体替换」任务自带的 tracker 列表，所以以前把磁力里的
// &tr= 全部冲掉了 —— 私有站/小众站的种子只有它自己的 tracker 上有 peer，结果就是一直
// 「解析失败」或 0 连接。这里改成：任务自带的 tracker 优先保留，再并入用户配置/内置列表。

// 去掉协议差异、大小写与结尾斜杠后再比较，避免同一 tracker 重复进 bt-tracker
function normalizeTracker(tracker: string): string {
  return tracker.trim().toLowerCase().replace(/\/+$/, '')
}

// 拆字符串列表（支持逗号/空白/换行分隔，兼容设置页与磁力两种来源）
export function splitTrackers(value: string): string[] {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean)
}

// 合并并去重：先放任务自带的，再放追加列表；dht:// 之类的非 http/udp 形式保留（aria2 会忽略）
export function mergeTrackers(taskTrackers: string[], extraTrackers: string[]): string[] {
  const seen = new Set<string>()
  const merged: string[] = []
  for (const tracker of [...taskTrackers, ...extraTrackers]) {
    const key = normalizeTracker(tracker)
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(tracker.trim())
  }
  return merged
}

// 从磁力链接里取出 &tr= 参数（已做百分号解码）；同一 tracker 出现多次只保留一次
export function trackersFromMagnet(magnet: string, decode: (value: string) => string = decodeURIComponent): string[] {
  if (!magnet.startsWith('magnet:?')) return []
  const found: string[] = []
  for (const pair of magnet.slice('magnet:?'.length).split('&')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).toLowerCase() !== 'tr') continue
    let value = pair.slice(index + 1)
    try { value = decode(value) } catch { /* 非法转义时用原文 */ }
    if (value) found.push(value)
  }
  return mergeTrackers(found, [])
}

// 构造 aria2 的 bt-tracker 值：任务自带优先，再补上配置里的公共 tracker。
// 显式传空字符串（用户清空了自定义列表）时仍会用内置快照，与 trackerList 的既有语义一致。
export function buildBtTrackers(magnet: string | undefined, extra: string[]): string[] {
  const own = magnet ? trackersFromMagnet(magnet) : []
  return mergeTrackers(own, extra)
}
