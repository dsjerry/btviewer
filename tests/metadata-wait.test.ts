import { describe, expect, it } from 'vitest'
import { METADATA_GIVE_UP_MS, METADATA_SLOW_AFTER_MS, decideMetadataPhase, type MetadataSnapshot } from '../electron/metadata-wait'

// 磁力元数据阶段的判定：以前 30 秒硬超时报「解析失败」，冷门种子被误判

const base: MetadataSnapshot = { isPlaceholder: true, hasFiles: false, hasName: false, followedBy: false, connections: 0 }

describe('decideMetadataPhase', () => {
  it('拿到真实文件列表即完成', () => {
    const snapshot = { ...base, isPlaceholder: false, hasFiles: true, hasName: true, connections: 3 }
    expect(decideMetadataPhase(snapshot, 1000)).toMatchObject({ phase: 'ready', done: true })
  })

  it('只有 [METADATA] 占位文件时不算完成', () => {
    const snapshot = { ...base, hasFiles: true, isPlaceholder: true }
    expect(decideMetadataPhase(snapshot, 1000).phase).toBe('waiting')
  })

  it('元数据到手但后续任务未接管时继续等待（settling）', () => {
    const snapshot = { ...base, hasFiles: true, isPlaceholder: true, hasName: true }
    expect(decideMetadataPhase(snapshot, 5000)).toMatchObject({ phase: 'settling', done: false })
  })

  it('刚开始时是正常等待', () => {
    expect(decideMetadataPhase({ ...base, connections: 1 }, 0)).toMatchObject({ phase: 'waiting', done: false })
    expect(decideMetadataPhase({ ...base, connections: 1 }, METADATA_SLOW_AFTER_MS - 1).phase).toBe('waiting')
  })

  it('超过慢阈值且零连接时给出「无 peer」提示，但不结束', () => {
    const decision = decideMetadataPhase({ ...base, connections: 0 }, METADATA_SLOW_AFTER_MS)
    expect(decision).toMatchObject({ phase: 'stalled', messageKey: 'metadata.noPeers', done: false })
  })

  it('超过慢阈值但仍有连接时继续等待（说明只是慢）', () => {
    expect(decideMetadataPhase({ ...base, connections: 5 }, METADATA_SLOW_AFTER_MS).phase).toBe('waiting')
  })

  it('到上限后结束等待，但不算错误', () => {
    const decision = decideMetadataPhase({ ...base, connections: 2 }, METADATA_GIVE_UP_MS)
    expect(decision).toMatchObject({ phase: 'stalled', done: true })
    expect(decision.phase).not.toBe('error')
  })

  it('任务出错才是 error', () => {
    const decision = decideMetadataPhase({ ...base, error: 'unrecognized torrent' }, 100, {})
    expect(decision).toMatchObject({ phase: 'error', done: true })
  })

  it('阈值可注入，便于测试边界', () => {
    expect(decideMetadataPhase({ ...base, connections: 0 }, 1500, { slowAfterMs: 1000, giveUpAfterMs: 5000 }).phase).toBe('stalled')
    expect(decideMetadataPhase({ ...base, connections: 0 }, 6000, { slowAfterMs: 1000, giveUpAfterMs: 5000 }).done).toBe(true)
  })
})
