import { readFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'

const resource = (name: string) => readFileSync(new URL(`../resources/${name}`, import.meta.url))
const svg = resource('logo.svg')
const render = (size: number) => Buffer.from(new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng())

describe('application icons', () => {
  it('embeds the supplied PNG unchanged in the generated logo', () => {
    const source = resource('霓虹绿媒体下载播放器图标.png')
    expect(svg.toString().includes(`data:image/png;base64,${source.toString('base64')}`)).toBe(true)
    expect(svg.toString()).toContain('<clipPath')
  })

  it('keeps the desktop PNG in sync with the supplied artwork', () => {
    expect(resource('icon.png').equals(render(512))).toBe(true)
  })

  it('includes matching Windows icons from 16px to 256px', () => {
    const ico = resource('icon.ico')
    const sizes = [256, 128, 64, 48, 32, 16]
    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(sizes.length)
    let offset = 6 + sizes.length * 16
    sizes.forEach((size, index) => {
      const entry = 6 + index * 16
      const length = ico.readUInt32LE(entry + 8)
      expect(ico[entry] || 256).toBe(size)
      expect(ico[entry + 1] || 256).toBe(size)
      expect(ico.readUInt16LE(entry + 6)).toBe(32)
      expect(ico.readUInt32LE(entry + 12)).toBe(offset)
      expect(ico.subarray(offset, offset + length).equals(render(size))).toBe(true)
      offset += length
    })
    expect(offset).toBe(ico.length)
  })

  it('includes matching macOS icons through 1024px for Retina displays', () => {
    const icns = resource('icon.icns')
    const sizes = new Map([['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024]])
    expect(icns.toString('ascii', 0, 4)).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
    let offset = 8
    while (offset < icns.length) {
      const type = icns.toString('ascii', offset, offset + 4)
      const length = icns.readUInt32BE(offset + 4)
      const size = sizes.get(type)
      expect(length).toBeGreaterThan(8)
      expect(size).toBeDefined()
      expect(icns.subarray(offset + 8, offset + length).equals(render(size!))).toBe(true)
      sizes.delete(type)
      offset += length
    }
    expect(offset).toBe(icns.length)
    expect(sizes.size).toBe(0)
  })

  it('keeps transparent padding and visible artwork at every size', () => {
    for (const size of [16, 32, 128, 512, 1024]) {
      const { pixels } = new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: size } }).render()
      const alphaAt = (x: number, y: number) => pixels[(y * size + x) * 4 + 3]
      expect(alphaAt(0, 0)).toBe(0)
      expect(alphaAt(size - 1, size - 1)).toBe(0)
      expect(alphaAt(Math.floor(size / 2), Math.floor(size / 2))).toBeGreaterThan(240)
      expect(alphaAt(Math.floor(size / 2), 0)).toBe(0)
      expect(alphaAt(0, Math.floor(size / 2))).toBe(0)
      expect(alphaAt(size - 1, Math.floor(size / 2))).toBe(0)
      expect(alphaAt(Math.floor(size / 2), size - 1)).toBe(0)
      let visiblePixels = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 8) visiblePixels++
      }
      expect(visiblePixels / (size * size)).toBeGreaterThan(.6)
      expect(visiblePixels / (size * size)).toBeLessThan(.8)
    }
  })
})
