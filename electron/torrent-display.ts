// 磁力任务在「元数据未到手」阶段的两个展示细节：
// 1. aria2 会把 metadata 下载本身当成一个文件（`[METADATA]<hash>`），它被原样展示给用户时
//    看起来像解析成功，其实是垃圾数据；
// 2. 磁力链接里的 dn= 是唯一的可读名称，拿不到 metadata 时应该用它而不是 40 位 hash。

// aria2 的 metadata 占位文件名前缀（路径中可能带目录）
const METADATA_PREFIX = '[METADATA]'

export function isMetadataPlaceholder(path: string): boolean {
  if (!path) return false
  const name = path.split(/[\\/]/).pop() || ''
  return name.startsWith(METADATA_PREFIX)
}

// 过滤掉占位文件；返回新数组，调用方据此决定是否还显示「文件明细」
export function filterMetadataPlaceholders<T extends { path: string }>(files: T[]): T[] {
  if (!files.length) return files
  const kept = files.filter((file) => !isMetadataPlaceholder(file.path))
  return kept.length === files.length ? files : kept
}

// 从磁力链接取 dn= 参数（百分号解码、+ 解码为空格）
export function displayNameFromMagnet(magnet: string | undefined): string {
  if (!magnet || !magnet.startsWith('magnet:?')) return ''
  for (const pair of magnet.slice('magnet:?'.length).split('&')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).toLowerCase() !== 'dn') continue
    const raw = pair.slice(index + 1).replace(/\+/g, ' ')
    try {
      const decoded = decodeURIComponent(raw).trim()
      if (decoded) return decoded
    } catch { /* 非法转义时退回原文 */ }
    const trimmed = raw.trim()
    if (trimmed) return trimmed
  }
  return ''
}

// 任务显示名优先级：aria2 给出的 bt 名称 > 磁力 dn= > 已有任务名 > 哈希
export function resolveTaskName(input: { btName?: string; magnet?: string; storedName?: string; hash: string }): string {
  return input.btName || displayNameFromMagnet(input.magnet) || input.storedName || input.hash
}
