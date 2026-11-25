// 人脸对齐（纯函数，不碰 DOM 与模型）：把 FaceLandmarker 的关键点映射为 ArcFace 5 点模板，
// 用最小二乘相似变换（旋转 + 等比缩放 + 平移，不含镜像）得到 112×112 对齐图的 2D 仿射矩阵。
// 模板与 OpenCV FaceRecognizerSF::alignCrop 的约定一致：点序为「画面中左眼、右眼、鼻尖、左嘴角、右嘴角」，x 小者为左。

export interface Point { x: number; y: number }
export type Affine = [a: number, b: number, c: number, d: number, e: number, f: number]

export const ALIGN_SIZE = 112
export const ARCFACE_TEMPLATE: Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: 41.5493, y: 92.3655 },
  { x: 70.7299, y: 92.2041 }
]

// MediaPipe FaceLandmarker（478 点）的关键点：虹膜中心 468 / 473，鼻尖 1，嘴角 61 / 291
const IRIS_CENTERS = [468, 473]
const NOSE_TIP = 1
const MOUTH_CORNERS = [61, 291]

// 归一化关键点 → 像素坐标，并按 x 排序取 5 个对齐点（与模板点序一致；左右跟随画面，而不是人物自身的左右）
export function alignmentPoints(landmarks: Point[], width: number, height: number): Point[] {
  const toPixel = (index: number): Point => ({ x: landmarks[index].x * width, y: landmarks[index].y * height })
  const byX = (indices: number[]) => indices.map(toPixel).sort((p, q) => p.x - q.x)
  const [eyeLeft, eyeRight] = byX(IRIS_CENTERS)
  const [mouthLeft, mouthRight] = byX(MOUTH_CORNERS)
  return [eyeLeft, eyeRight, toPixel(NOSE_TIP), mouthLeft, mouthRight]
}

// 复数形式的最小二乘：(a + ib) = Σ conj(src)·dst / Σ|src|²，即 dst = (a + ib)·src + t
// 返回 canvas 的 setTransform 参数，映射方向为 src → dst，可直接用于把原图 warp 到模板坐标系
export function similarityTransform(src: Point[], dst: Point[]): Affine {
  const n = src.length
  const centroid = (pts: Point[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / n, y: pts.reduce((s, p) => s + p.y, 0) / n })
  const cs = centroid(src)
  const cd = centroid(dst)
  let re = 0
  let im = 0
  let norm = 0
  src.forEach((p, i) => {
    const x = p.x - cs.x
    const y = p.y - cs.y
    const u = dst[i].x - cd.x
    const v = dst[i].y - cd.y
    re += x * u + y * v
    im += x * v - y * u
    norm += x * x + y * y
  })
  const a = re / norm
  const b = im / norm
  const e = cd.x - (a * cs.x - b * cs.y)
  const f = cd.y - (b * cs.x + a * cs.y)
  return [a, b, -b, a, e, f]
}

export function applyAffine(m: Affine, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

// 关键点的外接框（像素）：用于过滤过小的人脸，并作为人脸位置记录
export function boundingBox(landmarks: Point[], width: number, height: number): [number, number, number, number] {
  const xs = landmarks.map((p) => p.x * width)
  const ys = landmarks.map((p) => p.y * height)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  return [Math.round(x0), Math.round(y0), Math.round(Math.max(...xs) - x0), Math.round(Math.max(...ys) - y0)]
}
