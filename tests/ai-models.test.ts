import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { AI_MODELS, digestMatches, resolveAiAsset } from '../electron/ai-models'

// 模块顶层引入了 electron（app/net），被测的纯函数不会触达它
vi.mock('electron', () => ({ net: {}, app: { getPath: () => '/tmp', isPackaged: false, getAppPath: () => '/tmp' } }))

const roots = { mediapipe: '/app/mp', ort: '/app/ort', models: '/data/models' }

describe('resolveAiAsset', () => {
  // 路径分隔符随平台变化（Windows 为反斜杠），期望值统一用 join 生成
  it('只放行固定根目录下的单个文件名', () => {
    expect(resolveAiAsset('wasm', 'vision_wasm_internal.js', roots)).toBe(join('/app/mp', 'vision_wasm_internal.js'))
    expect(resolveAiAsset('ort', 'ort-wasm-simd-threaded.wasm', roots)).toBe(join('/app/ort', 'ort-wasm-simd-threaded.wasm'))
    expect(resolveAiAsset('models', AI_MODELS.sface.file, roots)).toBe(join('/data/models', AI_MODELS.sface.file))
    expect(resolveAiAsset('models', AI_MODELS.face.file, roots)).toBe(join('/data/models', AI_MODELS.face.file))
  })

  it('拒绝路径穿越、未知模型与未知目录', () => {
    expect(resolveAiAsset('wasm', '../secret.js', roots)).toBeNull()
    expect(resolveAiAsset('ort', 'sub/ort-wasm.wasm', roots)).toBeNull()
    expect(resolveAiAsset('ort', 'package.json', roots)).toBeNull()
    expect(resolveAiAsset('models', 'evil.onnx', roots)).toBeNull()
    expect(resolveAiAsset('other', 'hand_landmarker.task', roots)).toBeNull()
    expect(resolveAiAsset('wasm', '', roots)).toBeNull()
  })
})

describe('digestMatches', () => {
  it('按 SHA256 十六进制比对内容', () => {
    const abc = Buffer.from('abc')
    expect(digestMatches(abc, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')).toBe(true)
    expect(digestMatches(abc, '0'.repeat(64))).toBe(false)
  })

  it('每个登记模型都带有 64 位十六进制校验值', () => {
    for (const spec of Object.values(AI_MODELS)) expect(spec.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
