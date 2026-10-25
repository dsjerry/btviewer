// 立体 WebGL 渲染器：平面红青合并（anaglyph）与 VR180 球面投影共用一套纹理上传与帧调度。
// - 平面：把 SBS/TB 打包帧的左眼映到红通道、右眼映到绿/蓝通道，合成一帧普通画面；
//   水平视差可微调（对齐不准的片源由调用方拖拽驱动 setMode）；也支持单眼与左右分屏双视图。
// - 球面：把双眼鱼眼画面贴到 180° 半球（VR180 标准），相机 yaw/pitch/fov 由调用方
//   的拖拽/滚轮驱动；输出支持红蓝合并、单眼全景（YouTube VR 观感，按显示区宽高比
//   渲染透视）、左右分屏双视图（VR 头显格式，每半仍为完整透视）。
// 上下文丢失/首帧绘制出错通过 onFailure 上报，调用方应摘掉画布回退原画面。

const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAGMENT_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_video;
uniform float u_proj;      // 0 = 平面合并, 1 = 球面
uniform float u_isTb;      // 平面: 0 = 左右并排, 1 = 上下排列
uniform float u_parallax;  // 平面: 水平视差（相对眼区宽度的比例，左右对称偏移）
uniform float u_out;       // 0 = 红蓝合并, 1 = 单眼(左), 2 = 左右分屏, 3 = 单眼(右)
uniform vec3 u_fwd;        // 相机基向量（调用方由 yaw/pitch 计算）
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_tanHalfFov;
uniform float u_aspect;    // 球面: 单个视角的宽高比（全景视图随播放器显示区拉伸，分屏时为显示区的一半）
uniform float u_ipd;       // 双眼间距（球面半径 = 1）

vec3 sampleEye(vec2 uv, float side) {
  vec2 origin = mix(vec2(side * 0.5, 0.0), vec2(0.0, side * 0.5), u_isTb);
  vec2 scale = mix(vec2(0.5, 1.0), vec2(1.0, 0.5), u_isTb);
  return texture2D(u_video, origin + clamp(uv, 0.0, 1.0) * scale).rgb;
}

// 半色优化 anaglyph：红通道取左眼亮度，绿/蓝取右眼——红青眼镜下立体感与色彩伪影的折中
vec3 anaglyph(vec3 left, vec3 right) {
  return vec3(dot(left, vec3(0.299, 0.587, 0.114)), right.g, right.b);
}

vec4 flatMode(vec2 uv) {
  if (u_out > 2.5) return vec4(sampleEye(uv, 1.0), 1.0);
  if (u_out > 1.5) {
    // 左右分屏双视图：左半幅取左眼、右半幅取右眼，各自完整占满半幅
    float side = uv.x < 0.5 ? 0.0 : 1.0;
    return vec4(sampleEye(vec2(fract(uv.x * 2.0), uv.y), side), 1.0);
  }
  if (u_out > 0.5) return vec4(sampleEye(uv, 0.0), 1.0);
  float shift = u_parallax * mix(0.5, 1.0, u_isTb);
  vec3 left = sampleEye(uv + vec2(-shift * 0.5, 0.0), 0.0);
  vec3 right = sampleEye(uv + vec2(shift * 0.5, 0.0), 1.0);
  return vec4(anaglyph(left, right), 1.0);
}

// 视线与单位球（球心=原点）求交，落点方向经等距鱼眼投影映射到眼区 uv（[0,1]，y 向下）；
// 视线朝后或超出 180° 鱼眼范围返回 -1（渲染为黑）。
// 观察点恒在球内（IPD 偏移 ≪ 半径 1），取前方交点必须用 +sqrt 根：-sqrt 根在相机背后恒为负。
// 鱼眼贴片固定在世界坐标：光轴 = 片源前方（-Z）、上 = +Y、右 = +X——不能用随相机旋转的
// u_fwd/u_right/u_up，否则拖拽转视角时整个鱼眼坐标系跟着转，画面纹丝不动。
vec2 fisheyeUv(vec3 dir, vec3 camPos) {
  float b = dot(camPos, dir);
  float disc = b * b - dot(camPos, camPos) + 1.0;
  if (disc <= 0.0) return vec2(-1.0);
  float t = -b + sqrt(disc);
  if (t <= 0.0) return vec2(-1.0);
  vec3 d = normalize(camPos + dir * t);
  float cosA = -d.z;
  if (cosA <= 0.0) return vec2(-1.0);
  float r = acos(clamp(cosA, -1.0, 1.0)) * 0.63661977;
  if (r > 1.0) return vec2(-1.0);
  // 鱼眼圆正立存放：场景上方对应圆的上缘（uv.y 变小）、右方对应右缘（uv.x 变大）。
  // GLSL atan(y, x) 的 y 取 up 分量、x 取 right 分量——两者写反会把整个场景旋转 90°
  float theta = atan(d.y, d.x);
  return vec2(0.5 + 0.5 * r * cos(theta), 0.5 - 0.5 * r * sin(theta));
}

vec4 sphereMode(vec2 uv) {
  float side = 0.0;
  if (u_out > 2.5) {
    side = 1.0;
  } else if (u_out > 1.5) {
    // 分屏：先换算到半幅 uv 再求视线——两半各显示完整视角（在重映射前求视线会只剩半个视野）
    side = uv.x < 0.5 ? 0.0 : 1.0;
    uv.x = fract(uv.x * 2.0);
  }
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  vec3 dir = normalize(u_fwd + u_right * (ndc.x * u_tanHalfFov * u_aspect) + u_up * (ndc.y * u_tanHalfFov));
  if (u_out < 0.5) {
    vec2 luv = fisheyeUv(dir, u_right * (-0.5 * u_ipd));
    vec2 ruv = fisheyeUv(dir, u_right * (0.5 * u_ipd));
    if (luv.x < 0.0 && ruv.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
    vec3 left = sampleEye(max(luv, vec2(0.0)), 0.0);
    vec3 right = sampleEye(max(ruv, vec2(0.0)), 1.0);
    return vec4(anaglyph(left, right), 1.0);
  }
  vec2 fuv = fisheyeUv(dir, u_right * ((side - 0.5) * u_ipd));
  if (fuv.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  return vec4(sampleEye(fuv, side), 1.0);
}

void main() {
  gl_FragColor = u_proj < 0.5 ? flatMode(v_uv) : sphereMode(v_uv);
}
`

type VideoFrameScheduler = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number; cancelVideoFrameCallback?: (handle: number) => void }

export interface StereoCamera {
  // yaw/pitch 为弧度，fov 为整幅视角的角度数
  yaw: number
  pitch: number
  fov: number
}

export interface StereoGLMode {
  projection?: 'flat' | 'sphere'
  layout?: 'sbs' | 'tb'
  output?: 'left' | 'right' | 'anaglyph' | 'dual'
  parallax?: number
  camera?: StereoCamera
  // 双眼间距（球半径 = 1 时按真实 IPD 约 0.064）
  ipd?: number
}

const DEFAULT_CAMERA: StereoCamera = { yaw: 0, pitch: 0, fov: 90 }

export class StereoGLRenderer {
  readonly canvas: HTMLCanvasElement
  // 上下文丢失或首帧绘制出错时回调（调用方应摘掉画布回退原画面，避免黑屏盖住视频）
  onFailure: () => void = () => undefined
  private gl: WebGLRenderingContext
  private program: WebGLProgram
  private texture: WebGLTexture
  private locations: Record<string, WebGLUniformLocation | null>
  private video: VideoFrameScheduler | null = null
  private running = false
  private frameHandle = 0
  private projection: 'flat' | 'sphere' = 'flat'
  private layout: 'sbs' | 'tb' = 'sbs'
  private output: 'left' | 'right' | 'anaglyph' | 'dual' = 'anaglyph'
  private parallax = 0
  private camera: StereoCamera = DEFAULT_CAMERA
  private ipd = 0.064
  private failed = false
  private verified = false
  private uploadedAt = -1

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    // GPU 进程崩溃等会让上下文静默丢失：画布会停在最后一帧变黑盖住视频，必须监听并回退
    canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); this.fail() })
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader compile failed')
      return shader
    }
    const program = gl.createProgram()!
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SRC))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC))
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'program link failed')
    this.program = program
    gl.useProgram(program)
    // 全屏四边形
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_pos')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    // 视频纹理：采样到边缘即截断（CLAMP），颜色空间交给 Chromium 的 YUV→RGB 转换
    this.texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    this.locations = {}
    for (const name of ['u_video', 'u_proj', 'u_isTb', 'u_parallax', 'u_out', 'u_fwd', 'u_right', 'u_up', 'u_tanHalfFov', 'u_aspect', 'u_ipd']) {
      this.locations[name] = gl.getUniformLocation(program, name)
    }
    gl.uniform1i(this.locations.u_video, 0)
  }

  // 增量更新渲染模式：只覆盖传入的字段，其余保持上次值
  setMode(mode: StereoGLMode) {
    if (mode.projection) this.projection = mode.projection
    if (mode.layout) this.layout = mode.layout
    if (mode.output) this.output = mode.output
    if (mode.parallax !== undefined) this.parallax = Math.max(-0.1, Math.min(0.1, mode.parallax))
    if (mode.camera) this.camera = mode.camera
    if (mode.ipd !== undefined) this.ipd = mode.ipd
  }

  // 绑定视频并开始逐帧渲染；重复调用同源幂等，换 <video> 节点时先 stop 再 start
  start(video: HTMLVideoElement) {
    if (this.running && this.video === video) return
    this.stop()
    this.video = video as VideoFrameScheduler
    this.running = true
    this.schedule()
  }

  stop() {
    this.running = false
    const video = this.video
    this.video = null
    if (!video) return
    if (typeof video.cancelVideoFrameCallback === 'function' && this.frameHandle) video.cancelVideoFrameCallback(this.frameHandle)
    else cancelAnimationFrame(this.frameHandle)
  }

  // 立即重绘一帧。暂停/缓冲时 rVFC 不触发，拖拽视角、调视差等交互必须手动驱动重绘
  render() {
    this.draw()
  }

  private schedule() {
    if (!this.running || !this.video) return
    const video = this.video
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.frameHandle = video.requestVideoFrameCallback(() => { this.draw(); this.schedule() })
    } else {
      this.frameHandle = requestAnimationFrame(() => { this.draw(); this.schedule() })
    }
  }

  private fail() {
    if (this.failed) return
    this.failed = true
    this.stop()
    this.onFailure()
  }

  private draw() {
    const video = this.video
    if (!video || !video.videoWidth || !video.videoHeight) return
    const gl = this.gl
    const eyeWidth = this.layout === 'sbs' ? Math.round(video.videoWidth / 2) : video.videoWidth
    const eyeHeight = this.layout === 'sbs' ? video.videoHeight : Math.round(video.videoHeight / 2)
    // 画布 backing store：平面 = 单眼（分屏为两格宽）；球面 = 跟随显示区宽高比的全景视口
    // （分屏时每个视角占显示区一半，仍是完整透视），高度上限 2160 控制 8K 源的填充成本
    let width: number
    let height: number
    let viewAspect = 1
    if (this.projection === 'flat') {
      width = this.output === 'dual' ? eyeWidth * 2 : eyeWidth
      height = eyeHeight
    } else {
      const box = this.canvas
      const boxAspect = box.clientWidth > 0 && box.clientHeight > 0 ? box.clientWidth / box.clientHeight : 16 / 9
      const views = this.output === 'dual' ? 2 : 1
      viewAspect = boxAspect / views
      const side = Math.min(Math.min(eyeWidth, eyeHeight), 2160)
      width = Math.round(side * viewAspect * views)
      height = side
    }
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
    gl.viewport(0, 0, width, height)
    // 暂停时画面不再变化：跳过纹理重传，交互重绘只剩一次全屏光栅化（seek 后 currentTime 变化会重传）
    if (!video.paused || video.currentTime !== this.uploadedAt) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video)
      this.uploadedAt = video.currentTime
    }
    const { yaw, pitch, fov } = this.camera
    const cp = Math.cos(pitch)
    const sp = Math.sin(pitch)
    const cy = Math.cos(yaw)
    const sy = Math.sin(yaw)
    const fwd = [sy * cp, sp, -cy * cp]
    const right = [cy, 0, sy]
    const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]]
    gl.uniform1f(this.locations.u_proj, this.projection === 'sphere' ? 1 : 0)
    gl.uniform1f(this.locations.u_isTb, this.layout === 'tb' ? 1 : 0)
    gl.uniform1f(this.locations.u_parallax, this.parallax)
    gl.uniform1f(this.locations.u_out, this.output === 'anaglyph' ? 0 : this.output === 'left' ? 1 : this.output === 'dual' ? 2 : 3)
    gl.uniform3f(this.locations.u_fwd, fwd[0], fwd[1], fwd[2])
    gl.uniform3f(this.locations.u_right, right[0], right[1], right[2])
    gl.uniform3f(this.locations.u_up, up[0], up[1], up[2])
    gl.uniform1f(this.locations.u_tanHalfFov, Math.tan((fov / 2) * Math.PI / 180))
    gl.uniform1f(this.locations.u_aspect, viewAspect)
    gl.uniform1f(this.locations.u_ipd, this.ipd)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
    // 首帧后校验一次 GL 状态：上下文「创建成功但不可用」（GPU 进程异常）时不能让画布黑屏糊脸
    if (!this.verified) {
      this.verified = true
      if (gl.getError() !== gl.NO_ERROR) this.fail()
    }
  }

  dispose() {
    this.stop()
    this.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
