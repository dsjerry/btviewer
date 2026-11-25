// SFace 的输入与输出约定（纯函数）。与 OpenCV FaceRecognizerSF::feature 保持一致：
// 对齐后的 112×112 图像按 RGB 通道顺序、像素保持 0–255（不做均值方差归一化），以 NCHW 排列；输出特征做 L2 归一化后用余弦相似度比较。

export function sfaceInput(rgba: ArrayLike<number>, size: number): Float32Array {
  const pixels = size * size
  const out = new Float32Array(pixels * 3)
  for (let i = 0; i < pixels; i++) {
    out[i] = rgba[i * 4]
    out[pixels + i] = rgba[i * 4 + 1]
    out[pixels * 2 + i] = rgba[i * 4 + 2]
  }
  return out
}

export function l2Normalize(vector: ArrayLike<number>): number[] {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum) || 1
  return Array.from(vector, (value) => value / norm)
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na * nb) || 1)
}
