import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import * as ort from 'onnxruntime-web/wasm'
import { alignmentPoints, ALIGN_SIZE, ARCFACE_TEMPLATE, boundingBox, similarityTransform } from './face-align'
import { l2Normalize, sfaceInput } from './face-embed'
import type { DetectedFaceDraft } from './people'

// 人脸分析运行时（渲染层）：FaceLandmarker 检测 478 点 → 5 点相似变换对齐到 112×112 → SFace（ONNX）提取 128 维特征。
// 只在人物合集开启、模型已下载后动态加载；WASM 与模型经 ai:// 协议读取（见 electron/ai-models.ts）。
const MIN_FACE_PX = 48
const THUMB_QUALITY = 0.8

export interface FaceAnalyzer {
  analyze(bitmap: ImageBitmap, t: number): Promise<DetectedFaceDraft[]>
  close(): void
}

async function toDataUrl(canvas: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY })).arrayBuffer())
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:image/jpeg;base64,${btoa(binary)}`
}

export async function createFaceAnalyzer(): Promise<FaceAnalyzer> {
  ort.env.wasm.wasmPaths = 'ai://ort/'
  ort.env.wasm.numThreads = 1
  const vision = await FilesetResolver.forVisionTasks('ai://wasm')
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: 'ai://models/face_landmarker.task', delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 8
  })
  const session = await ort.InferenceSession.create('ai://models/face_recognition_sface_2021dec.onnx', { executionProviders: ['wasm'] })
  const inputName = session.inputNames[0]
  const outputName = session.outputNames[0]
  return {
    async analyze(bitmap, t) {
      const { width, height } = bitmap
      const drafts: DetectedFaceDraft[] = []
      for (const landmarks of landmarker.detect(bitmap).faceLandmarks) {
        const box = boundingBox(landmarks, width, height)
        if (Math.min(box[2], box[3]) < MIN_FACE_PX) continue
        const matrix = similarityTransform(alignmentPoints(landmarks, width, height), ARCFACE_TEMPLATE)
        const canvas = new OffscreenCanvas(ALIGN_SIZE, ALIGN_SIZE)
        const ctx = canvas.getContext('2d')
        if (!ctx) continue
        ctx.setTransform(...matrix)
        ctx.drawImage(bitmap, 0, 0)
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        const rgba = ctx.getImageData(0, 0, ALIGN_SIZE, ALIGN_SIZE).data
        const input = new ort.Tensor('float32', sfaceInput(rgba, ALIGN_SIZE), [1, 3, ALIGN_SIZE, ALIGN_SIZE])
        const output = await session.run({ [inputName]: input })
        drafts.push({ t, box, vector: l2Normalize(output[outputName].data as Float32Array), thumb: await toDataUrl(canvas) })
      }
      return drafts
    },
    close() {
      landmarker.close()
      void session.release()
    }
  }
}
