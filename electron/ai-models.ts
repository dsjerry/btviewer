import { app, net } from 'electron'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { AiModelId, AiModelStatus } from '../src/types'

// 可选 AI 模型（手势控制、人物合集）：不随安装包分发，用户在设置里确认后才下载。
// 下载后按固定 SHA256 校验，防止中途损坏或远端内容被替换。URL 固定到版本/提交，校验值不会因上游 latest 变化而失效。
// hand / face：MediaPipe 官方 .task 模型；sface：OpenCV Zoo 的人脸识别 ONNX（Apache-2.0），SHA256 与 Hugging Face / GitHub LFS 记录一致。
export interface AiModelSpec { file: string; url: string; sha256: string; bytes: number }

export const AI_MODELS: Record<AiModelId, AiModelSpec> = {
  hand: {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    sha256: 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1',
    bytes: 7819105
  },
  face: {
    file: 'face_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
    bytes: 3758596
  },
  sface: {
    file: 'face_recognition_sface_2021dec.onnx',
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/89e1f6f89ab68a12ab974b5b65162abf464a461f/face_recognition_sface_2021dec.onnx',
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
    bytes: 38696353
  }
}

export function aiModelsDir(): string {
  return join(app.getPath('userData'), 'models')
}

// 运行时 WASM：开发态直接读 node_modules，打包后来自 extraResources（见 electron-builder.yml）
export function aiRuntimeDir(name: 'mediapipe' | 'ort'): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'runtime', name)
    : join(app.getAppPath(), 'node_modules', ...(name === 'mediapipe' ? ['@mediapipe', 'tasks-vision', 'wasm'] : ['onnxruntime-web', 'dist']))
}

export function modelPath(id: AiModelId): string {
  return join(aiModelsDir(), AI_MODELS[id].file)
}

export function aiModelStatus(): AiModelStatus {
  const entries = Object.entries(AI_MODELS) as Array<[AiModelId, AiModelSpec]>
  return Object.fromEntries(entries.map(([id, spec]) => {
    const size = existsSync(modelPath(id)) ? statSync(modelPath(id)).size : 0
    return [id, { installed: size === spec.bytes, bytes: size }]
  })) as AiModelStatus
}

export function digestMatches(buffer: Uint8Array, sha256: string): boolean {
  return createHash('sha256').update(buffer).digest('hex') === sha256
}

// ai://wasm/<file>、ai://ort/<file>、ai://models/<file>：只放行固定根目录下的单个文件名，防止路径穿越
export function resolveAiAsset(host: string, name: string, roots: { mediapipe: string; ort: string; models: string }): string | null {
  if (!name || name !== basename(name)) return null
  if (host === 'wasm') return join(roots.mediapipe, name)
  if (host === 'ort' && name.startsWith('ort-wasm')) return join(roots.ort, name)
  if (host === 'models' && Object.values(AI_MODELS).some((spec) => spec.file === name)) return join(roots.models, name)
  return null
}

export async function downloadModel(id: AiModelId, onProgress?: (received: number, total: number) => void): Promise<string> {
  const spec = AI_MODELS[id]
  const target = modelPath(id)
  if (aiModelStatus()[id].installed) return target
  mkdirSync(dirname(target), { recursive: true })
  const response = await net.fetch(spec.url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`下载失败（HTTP ${response.status}），请检查网络或代理`)
  const total = Number(response.headers.get('content-length') || spec.bytes)
  const chunks: Buffer[] = []
  let received = 0
  for await (const chunk of response.body as unknown as Iterable<ArrayBuffer>) {
    chunks.push(Buffer.from(chunk))
    received += chunk.byteLength
    onProgress?.(received, total)
  }
  const buffer = Buffer.concat(chunks)
  if (!digestMatches(buffer, spec.sha256)) throw new Error('模型文件校验失败，已放弃安装')
  // 先写临时文件再改名：中断时不会留下一个看似完整的残缺模型
  writeFileSync(`${target}.part`, buffer)
  renameSync(`${target}.part`, target)
  return target
}

export function removeModel(id: AiModelId): void {
  rmSync(modelPath(id), { force: true })
}
