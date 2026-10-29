// 判断「请求的字节区间是否真的已经从 BT 下载到本地」。
// 背景：aria2 用 --file-allocation=none 时不预分配，任一分片下载完成文件就已存在且长度等于完整大小，
// 所以 statSync 成功 ≠ 数据可用。播放器探测 `bytes=0-0` 会因为文件存在而拿到 206，误判为「已就绪」，
// 真正读取时 moov 还在尾部没下到，Chromium 就报 MEDIA_ERR_SRC_NOT_SUPPORTED。
// 这里用 aria2 的 bitfield（每个 bit 对应一个分片）做精确判断。

// 从 bitfield 位数与总长度反推分片长度：bitfield 的高位对齐，末尾若干位是填充，
// pieceLength = ceil(totalLength / pieceCount)（aria2 保证最后一片可能更短）
export function pieceLengthFromBitfield(bitfield: string, totalLength: number): number {
  const bits = (bitfield || '').length * 4
  if (bits <= 0 || !Number.isFinite(totalLength) || totalLength <= 0) return 0
  return Math.ceil(totalLength / bits)
}

// aria2 的 bitfield 是十六进制字符串，高位在前；每 2 个十六进制字符 = 1 字节
export function isPieceDownloaded(bitfield: string, index: number): boolean {
  if (!bitfield || index < 0) return false
  // 分片 i 位于第 floor(i/8) 个字节、该字节内的第 (i%8) 位（高位在前）；
  // 十六进制每 2 个字符是一个字节
  const byteIndex = Math.floor(index / 8)
  const charIndex = byteIndex * 2
  if (charIndex + 1 >= bitfield.length) return false
  const byte = parseInt(bitfield.slice(charIndex, charIndex + 2), 16)
  if (!Number.isFinite(byte)) return false
  return ((byte >> (7 - (index % 8))) & 1) === 1
}

export interface PieceIndexInfo {
  // 分片长度（由 bitfield 位数与总长度反推，见 pieceLengthFromBitfield）
  pieceLength: number
  // 该文件在种子中的起始偏移（前面所有文件的长度之和）
  fileOffset: number
  // 文件长度
  fileLength: number
  // 需要检查的字节区间（相对文件起始）
  rangeStart: number
  rangeEnd: number
}

// 把文件的字节区间换算成「需要检查的分片索引」；分片可能跨文件边界，所以按整段覆盖计算
export function pieceIndexesForRange(info: PieceIndexInfo): number[] {
  const { pieceLength, fileOffset, fileLength, rangeStart, rangeEnd } = info
  if (!Number.isFinite(pieceLength) || pieceLength <= 0) return []
  const limit = Math.max(0, Math.min(fileLength, rangeEnd + 1))
  if (limit <= rangeStart) return []
  const absoluteStart = fileOffset + Math.max(0, rangeStart)
  const absoluteEnd = fileOffset + limit - 1
  const first = Math.floor(absoluteStart / pieceLength)
  const last = Math.floor(absoluteEnd / pieceLength)
  const indexes: number[] = []
  // 播放探测只看头尾，区间通常很小（几个字节），但 mp4 的 moov 可能在尾部几十 MB，
  // 这里限制上限，避免一次检查上千个分片
  for (let index = first; index <= last && indexes.length < 512; index++) indexes.push(index)
  return indexes
}

// 区间是否已完整下载；缺少 bitfield 时返回 true（无法判断就放行，避免误伤）
export function isRangeDownloaded(bitfield: string | undefined, info: PieceIndexInfo): boolean {
  if (!bitfield) return true
  const indexes = pieceIndexesForRange(info)
  if (!indexes.length) return true
  return indexes.every((index) => isPieceDownloaded(bitfield, index))
}

// 探测用的「头」区间：读 1 字节的探测无法保证 moov 存在，因此额外把文件头尾各一段纳入检查。
// 返回需要等待的区间（用于日志/提示），空数组表示可以放行。
export const PROBE_HEAD_BYTES = 1024 * 1024
export const PROBE_TAIL_BYTES = 4 * 1024 * 1024

export function probeRanges(fileLength: number): Array<{ start: number; end: number }> {
  if (!Number.isFinite(fileLength) || fileLength <= 0) return []
  const head = { start: 0, end: Math.min(fileLength, PROBE_HEAD_BYTES) - 1 }
  if (fileLength <= PROBE_HEAD_BYTES + PROBE_TAIL_BYTES) return [head]
  return [head, { start: Math.max(0, fileLength - PROBE_TAIL_BYTES), end: fileLength - 1 }]
}
