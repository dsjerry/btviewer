import { describe, expect, it } from 'vitest'
import { STEREO_MENU, stereoCropRect, stereoDisplay, stereoEqual, stereoFromName, STEREO_OFF } from '../src/services/stereo3d'

describe('stereoFromName', () => {
  it('识别上下排列的常见命名', () => {
    expect(stereoFromName('Movie.2023.1080p.3D.H-OU.mkv')?.layout).toBe('tb')
    expect(stereoFromName('Documentary.HOU.2160p.mp4')?.layout).toBe('tb')
    expect(stereoFromName('Film.TAB.1080p.mkv')?.layout).toBe('tb')
  })

  it('识别左右并排的常见命名', () => {
    expect(stereoFromName('Movie.2023.1080p.3D.HSBS.mkv')?.layout).toBe('sbs')
    expect(stereoFromName('Concert.Side.by.Side.mkv')?.layout).toBe('sbs')
  })

  it('VR180 鱼眼命名预选球面投影 + 全景视角', () => {
    expect(stereoFromName('RSRVR-001-A_4096p_8K_180_180x180_3dh_LR.mp4')).toEqual({
      layout: 'sbs', output: 'left', projection: 'sphere'
    })
    expect(stereoFromName('Trip.VR180.mkv')?.projection).toBe('sphere')
    expect(stereoFromName('Video.Fisheye.mp4')?.projection).toBe('sphere')
  })

  it('普通片名不误报', () => {
    expect(stereoFromName('S01E03.The.Office.mkv')).toBeNull()
    expect(stereoFromName('Ordinary.Movie.2023.mp4')).toBeNull()
    expect(stereoFromName('Soundtrack.MP3.pack.mp4')).toBeNull()
  })

  it('上下优先于左右（同时出现时按上下）', () => {
    expect(stereoFromName('Movie.3D.H-OU.1080p.mkv')?.layout).toBe('tb')
  })
})

describe('STEREO_MENU / stereoEqual', () => {
  it('菜单首项为关闭，其余选项互不重复且覆盖平面与球面', () => {
    expect(STEREO_MENU[0]).toEqual(STEREO_OFF)
    const keys = STEREO_MENU.map((mode) => `${mode.layout}|${mode.output}|${mode.projection}`)
    expect(new Set(keys).size).toBe(STEREO_MENU.length)
    expect(STEREO_MENU.some((mode) => mode.projection === 'sphere' && mode.output === 'dual')).toBe(true)
    // 球面只配左右并排（VR180 固定 SBS 封装）
    expect(STEREO_MENU.every((mode) => mode.projection === 'flat' || mode.layout === 'sbs')).toBe(true)
  })

  it('stereoEqual 按三个字段比较', () => {
    expect(stereoEqual(STEREO_OFF, { ...STEREO_OFF })).toBe(true)
    expect(stereoEqual(STEREO_OFF, { ...STEREO_OFF, layout: 'sbs' })).toBe(false)
    expect(stereoEqual({ layout: 'sbs', output: 'left', projection: 'flat' }, { layout: 'sbs', output: 'left', projection: 'sphere' })).toBe(false)
  })
})

describe('stereoDisplay', () => {
  it('关闭时返回 null', () => {
    expect(stereoDisplay(STEREO_OFF, 1920, 1080)).toBeNull()
    expect(stereoDisplay({ layout: 'sbs', output: 'left', projection: 'flat' }, 0, 1080)).toBeNull()
  })

  it('挤压封装 SBS：眼区回到整帧比例（1920×1080 的半宽眼区应显示为 16:9）', () => {
    const view = stereoDisplay({ layout: 'sbs', output: 'left', projection: 'flat' }, 1920, 1080)
    expect(view?.kind).toBe('crop')
    expect(view?.viewBox).toBe('inset(0px 960px 0px 0px)')
    expect(view).toMatchObject({ aspectWidth: 16, aspectHeight: 9 })
  })

  it('原生封装 SBS：眼区即真实比例（3840×1080 单眼 1920×1080）', () => {
    const view = stereoDisplay({ layout: 'sbs', output: 'right', projection: 'flat' }, 3840, 1080)
    expect(view?.viewBox).toBe('inset(0px 0px 0px 1920px)')
    expect(view).toMatchObject({ aspectWidth: 16, aspectHeight: 9 })
  })

  it('挤压封装 TB：眼区比例超出范围时回退整帧比例', () => {
    const view = stereoDisplay({ layout: 'tb', output: 'left', projection: 'flat' }, 1920, 1080)
    expect(view?.viewBox).toBe('inset(0px 0px 540px 0px)')
    expect(view).toMatchObject({ aspectWidth: 16, aspectHeight: 9 })
  })

  it('原生封装 TB：眼区比例在范围内时直接采用', () => {
    const view = stereoDisplay({ layout: 'tb', output: 'right', projection: 'flat' }, 1920, 2160)
    expect(view?.viewBox).toBe('inset(1080px 0px 0px 0px)')
    expect(view).toMatchObject({ aspectWidth: 16, aspectHeight: 9 })
  })

  it('宽银幕原生封装保持宽银幕比例并约分', () => {
    const view = stereoDisplay({ layout: 'sbs', output: 'left', projection: 'flat' }, 3840, 1632)
    expect(view).toMatchObject({ aspectWidth: 40, aspectHeight: 17 })
  })

  it('平面红蓝合并：不做 object-view-box 裁剪，画幅与单眼一致', () => {
    const view = stereoDisplay({ layout: 'sbs', output: 'anaglyph', projection: 'flat' }, 1920, 1080)
    expect(view?.kind).toBe('gl-flat')
    expect(view?.viewBox).toBe('')
    expect(view).toMatchObject({ aspectWidth: 16, aspectHeight: 9 })
  })

  it('平面分屏双视图：画幅为单眼的两倍宽（挤压与原生封装一致）', () => {
    // 挤压封装 1920×1080：单眼按 16:9 显示，两幅并排为 32:9
    const squeezed = stereoDisplay({ layout: 'sbs', output: 'dual', projection: 'flat' }, 1920, 1080)
    expect(squeezed?.kind).toBe('gl-flat')
    expect(squeezed).toMatchObject({ aspectWidth: 32, aspectHeight: 9 })
    // 原生封装 3840×1080：单眼 1920×1080，两幅并排同为 32:9
    const native = stereoDisplay({ layout: 'tb', output: 'dual', projection: 'flat' }, 1920, 2160)
    expect(native).toMatchObject({ kind: 'gl-flat', aspectWidth: 32, aspectHeight: 9 })
  })

  it('球面投影：单眼/红蓝为 1:1 画幅，分屏为 2:1', () => {
    const view = stereoDisplay({ layout: 'sbs', output: 'anaglyph', projection: 'sphere' }, 4096, 2048)
    expect(view?.kind).toBe('sphere')
    expect(view?.viewBox).toBe('')
    expect(view).toMatchObject({ aspectWidth: 1, aspectHeight: 1 })
    const dual = stereoDisplay({ layout: 'sbs', output: 'dual', projection: 'sphere' }, 4096, 2048)
    expect(dual).toMatchObject({ kind: 'sphere', aspectWidth: 2, aspectHeight: 1 })
  })
})

describe('stereoCropRect', () => {
  it('SBS 左眼取左半幅，右眼取右半幅', () => {
    expect(stereoCropRect({ layout: 'sbs', output: 'left', projection: 'flat' }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 960, height: 1080 })
    expect(stereoCropRect({ layout: 'sbs', output: 'right', projection: 'flat' }, 1920, 1080)).toEqual({ left: 960, top: 0, width: 960, height: 1080 })
  })

  it('TB 左眼取上半幅，右眼取下半幅', () => {
    expect(stereoCropRect({ layout: 'tb', output: 'left', projection: 'flat' }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 1920, height: 540 })
    expect(stereoCropRect({ layout: 'tb', output: 'right', projection: 'flat' }, 1920, 1080)).toEqual({ left: 0, top: 540, width: 1920, height: 540 })
  })

  it('红蓝合并/球面截图取左眼原色', () => {
    expect(stereoCropRect({ layout: 'sbs', output: 'anaglyph', projection: 'flat' }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 960, height: 1080 })
    expect(stereoCropRect({ layout: 'sbs', output: 'anaglyph', projection: 'sphere' }, 1920, 1080)).toEqual({ left: 0, top: 0, width: 960, height: 1080 })
  })

  it('关闭时返回 null', () => {
    expect(stereoCropRect(STEREO_OFF, 1920, 1080)).toBeNull()
  })
})
