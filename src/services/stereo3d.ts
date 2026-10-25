// 3D 视角选择（左右并排 SBS / 上下排列 TB）的纯逻辑：文件名识别、单眼裁剪框、单眼画幅宽高比、菜单选项。
// 「左眼/右眼」由渲染层用 CSS object-view-box 裁剪（眼区在源帧内的位置换算集中在这里）；
// 「红蓝合并」「分屏双视图」与「球面 VR180」交给 WebGL 渲染器（见 stereo-gl.ts），这里只负责画幅换算与输出判定。
// 不碰 DOM，便于穷举单测。

export type StereoLayout = 'off' | 'sbs' | 'tb'
// 输出方式：单眼原色、双眼红青合并（anaglyph）、左右分屏双视图（球面模式用）
export type StereoOutput = 'left' | 'right' | 'anaglyph' | 'dual'
// 投影：平面（裁剪/合并）或球面（VR180 鱼眼贴半球，可拖拽旋转视角）
export type StereoProjection = 'flat' | 'sphere'
export interface StereoMode {
  layout: StereoLayout
  output: StereoOutput
  projection: StereoProjection
}

export const STEREO_OFF: StereoMode = { layout: 'off', output: 'left', projection: 'flat' }

// 文件名启发式：容器元数据基本不标 3D 布局，只能靠命名约定预选（可被手动设置覆盖）。
// 上下排列优先判断（H-OU/HOU/TAB），再判左右（HSBS/SBS/Side-by-Side/3D[HBVU]）；
// 裸 "3D" 按最常见的 SBS 预选；VR180 鱼眼命名（180/3dh/fisheye 等）预选球面投影 + 全景视角。
// 注意 \b 会把下划线当单词字符，"8K_180_3dh" 这类命名必须用「非字母数字」边界。
const B = String.raw`(?<![a-z0-9])`
const A = String.raw`(?![a-z0-9])`
const TB_NAME_RE = new RegExp(`(half.?ou|${B}hou${A}|over.?under|top.?and.?bottom|top.?bottom|${B}tbu?${A}|${B}tab${A}|${B}ou${A})`, 'i')
const SBS_NAME_RE = new RegExp(`(half.?sbs|${B}hsbs${A}|side.?by.?side|${B}sbs${A}|stereoscop|${B}3d[hbvu]?${A})`, 'i')
const VR_NAME_RE = new RegExp(`(${B}180${A}|vr180|fisheye|${B}3dh${A})`, 'i')

export function stereoFromName(name: string): StereoMode | null {
  const vr = VR_NAME_RE.test(name)
  // VR180 文件必然是左右并排封装：命中 VR 命名但没写 SBS 字样时也按 sbs 处理
  const layout: StereoLayout | null = TB_NAME_RE.test(name) ? 'tb' : SBS_NAME_RE.test(name) ? 'sbs' : vr ? 'sbs' : null
  if (!layout) return null
  // 球面预选全景视角（单眼拖拽观看，无需眼镜）；红蓝立体在菜单里一键可切
  return vr
    ? { layout, output: 'left', projection: 'sphere' }
    : { layout, output: 'left', projection: 'flat' }
}

// 播放器 3D 菜单的固定选项（关闭 → 平面左右 → 平面上下 → 球面 VR180，布局均为 sbs）。
// 球面只配 sbs：VR180 源固定左右并排封装；平面含双视图（两幅单眼并排对比）。
export const STEREO_MENU: StereoMode[] = [
  STEREO_OFF,
  { layout: 'sbs', output: 'anaglyph', projection: 'flat' },
  { layout: 'sbs', output: 'left', projection: 'flat' },
  { layout: 'sbs', output: 'right', projection: 'flat' },
  { layout: 'sbs', output: 'dual', projection: 'flat' },
  { layout: 'tb', output: 'anaglyph', projection: 'flat' },
  { layout: 'tb', output: 'left', projection: 'flat' },
  { layout: 'tb', output: 'right', projection: 'flat' },
  { layout: 'tb', output: 'dual', projection: 'flat' },
  { layout: 'sbs', output: 'anaglyph', projection: 'sphere' },
  { layout: 'sbs', output: 'left', projection: 'sphere' },
  { layout: 'sbs', output: 'right', projection: 'sphere' },
  { layout: 'sbs', output: 'dual', projection: 'sphere' }
]

export function stereoEqual(a: StereoMode, b: StereoMode): boolean {
  return a.layout === b.layout && a.output === b.output && a.projection === b.projection
}

// 显示方式：crop = 单眼（对 <video> 施加 object-view-box）；
// gl-flat = 平面红蓝合并/分屏双视图（WebGL 画布接管）；sphere = VR180 球面（WebGL 画布接管）
export interface StereoDisplay {
  kind: 'crop' | 'gl-flat' | 'sphere'
  // kind='crop' 时的 object-view-box 取景框（像素 inset）；其余为空串
  viewBox: string
  // 该视角应有的显示宽高比（已约分）。播放器盒子固定为容器大小（fill 模式），
  // 此值不再喂给 video.js aspectRatio（会注入 fluid padding 顶飞控制条），仅作语义记录
  aspectWidth: number
  aspectHeight: number
}

// 截图用的眼区矩形（源帧像素坐标）；红蓝合并/球面模式下取左眼原色
export interface StereoCrop {
  left: number
  top: number
  width: number
  height: number
}

function gcd(a: number, b: number): number {
  while (b) { [a, b] = [b, a % b] }
  return a || 1
}

function stereoCrop(mode: StereoMode, width: number, height: number): StereoCrop | null {
  if (mode.layout === 'off' || width <= 0 || height <= 0) return null
  // 合并输出与左眼取同一块眼区（合并画面 = 左眼画幅）；截图时取它就是左眼原色
  const useLeft = mode.output !== 'right'
  if (mode.layout === 'sbs') {
    const half = Math.round(width / 2)
    return useLeft
      ? { left: 0, top: 0, width: half, height }
      : { left: width - half, top: 0, width: half, height }
  }
  const half = Math.round(height / 2)
  return useLeft
    ? { left: 0, top: 0, width, height: half }
    : { left: 0, top: height - half, width, height: half }
}

export function stereoDisplay(mode: StereoMode, width: number, height: number): StereoDisplay | null {
  const crop = stereoCrop(mode, width, height)
  if (!crop) return null
  // 球面：aspectRatio 已被播放器容器的 CSS 固定，这里只区分分屏（2:1）与其它（1:1）作占位
  if (mode.projection === 'sphere') {
    return { kind: 'sphere', viewBox: '', aspectWidth: mode.output === 'dual' ? 2 : 1, aspectHeight: 1 }
  }
  // 单眼画幅：眼区宽高比落在常见电影画幅范围内视为原生封装（眼区即真实比例，直接采用）；
  // 超出范围视为挤压封装（半分辨率眼区，显示时应拉伸回整帧比例）
  const eyeRatio = crop.width / crop.height
  const native = eyeRatio >= 1.6 && eyeRatio <= 2.45
  const eyeWidth = native ? crop.width : width
  const eyeHeight = native ? crop.height : height
  // 分屏双视图：两幅单眼并排，画幅为单眼的两倍宽
  const outWidth = mode.output === 'dual' ? eyeWidth * 2 : eyeWidth
  const divisor = gcd(outWidth, eyeHeight)
  if (mode.output === 'anaglyph' || mode.output === 'dual') {
    return { kind: 'gl-flat', viewBox: '', aspectWidth: outWidth / divisor, aspectHeight: eyeHeight / divisor }
  }
  const viewBox =
    mode.layout === 'sbs'
      ? mode.output === 'left'
        ? `inset(0px ${crop.width}px 0px 0px)`
        : `inset(0px 0px 0px ${crop.left}px)`
      : mode.output === 'left'
        ? `inset(0px 0px ${height - crop.height}px 0px)`
        : `inset(${crop.top}px 0px 0px 0px)`
  return { kind: 'crop', viewBox, aspectWidth: outWidth / divisor, aspectHeight: eyeHeight / divisor }
}

export function stereoCropRect(mode: StereoMode, width: number, height: number): StereoCrop | null {
  return stereoCrop(mode, width, height)
}
