// 容器立体元数据探测（文件名提示的补充）：ffprobe 读流里的 stereo_mode（Matroska 走 stream TAG、
// MP4 走 side_data_list）与球面投影标记。纯解析函数 + 可注入执行器，便于穷举单测。
// 解析策略：对 ffprobe 的 JSON 整体做关键词扫描——TAG / side_data 的输出形态有版本差异，
// 但 stereo_mode / spherical 的关键词本身稳定；球面（VR180）优先于普通立体。
import { execFile } from 'child_process'
import type { StereoMode } from '../src/services/stereo3d'

export type ProbeExecutor = (binary: string, args: string[]) => Promise<string>

export function parseStereoFromProbe(stdout: string): StereoMode | null {
  let text = stdout.toLowerCase()
  try { text = JSON.stringify(JSON.parse(stdout)).toLowerCase() } catch { /* 保留原文扫描 */ }
  if (!text) return null
  // 球面 / VR180：equirectangular 投影、spherical 标记（优先级最高，双眼鱼眼贴半球）
  if (text.includes('equirectangular') || text.includes('spherical')) {
    return { layout: 'sbs', output: 'left', projection: 'sphere' }
  }
  if (text.includes('side_by_side')) return { layout: 'sbs', output: 'left', projection: 'flat' }
  if (text.includes('top_and_bottom')) return { layout: 'tb', output: 'left', projection: 'flat' }
  // 有立体标记但排布未识别（如 MP4 的 Stereoscopic 3D 裸 side_data）：按最常见的 SBS 预选
  if (text.includes('row_interleaved') || text.includes('frame_sequential') || text.includes('stereoscopic')) {
    return { layout: 'sbs', output: 'left', projection: 'flat' }
  }
  return null
}

// ffprobe 探测 + 超时兜底：部分下载的文件 moov 可能缺失，失败/超时一律返回 null（保持现状）
export async function probeStereoFromContainer(ffprobePath: string, filePath: string, executor: ProbeExecutor = defaultExecutor, timeoutMs = 6000): Promise<StereoMode | null> {
  try {
    const stdout = await executor(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath])
    if (!stdout.trim()) return null
    return parseStereoFromProbe(stdout)
  } catch { return null }
}

function defaultExecutor(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 6000 }, (error, stdout) => {
      if (error && !stdout) reject(error)
      else resolve(stdout || '')
    })
  })
}
