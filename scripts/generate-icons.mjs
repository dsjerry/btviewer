// 从 resources/logo.svg 生成 electron-builder 所需的全套图标：
//   resources/icon.png (512) / resources/icon.ico (多尺寸) / resources/icon.icns (多尺寸)
// 用法：node scripts/generate-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'

const source = readFileSync('resources/霓虹绿媒体下载播放器图标.png')
const width = source.readUInt32BE(16)
const height = source.readUInt32BE(20)
const image = `<image width="${width}" height="${height}" href="data:image/png;base64,${source.toString('base64')}"/>`
const original = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${image}</svg>`, { font: { loadSystemFonts: false } }).render()
const pixels = original.pixels
let left = width, top = height, right = -1, bottom = -1
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] <= 8) continue
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
}
if (right < left || bottom < top) throw new Error('Source icon contains no visible artwork')
const artworkWidth = right - left + 1
const artworkHeight = bottom - top + 1
const extent = Math.ceil(Math.max(artworkWidth, artworkHeight) / .875)
const viewX = left + (artworkWidth - extent) / 2
const viewY = top + (artworkHeight - extent) / 2
writeFileSync('resources/logo.svg', `<svg width="512" height="512" viewBox="${viewX} ${viewY} ${extent} ${extent}" xmlns="http://www.w3.org/2000/svg">
  <defs><clipPath id="artwork"><rect x="${left}" y="${top}" width="${artworkWidth}" height="${artworkHeight}"/></clipPath></defs>
  <g clip-path="url(#artwork)">${image}</g>
</svg>
`)
const svg = readFileSync('resources/logo.svg')

function renderPng(size) {
  return new Resvg(svg, { font: { loadSystemFonts: false }, fitTo: { mode: 'width', value: size }, background: 'rgba(0,0,0,0)' }).render().asPng()
}

writeFileSync('resources/icon.png', renderPng(512))

// ICO：目录头 + 每个尺寸一条目录项 + PNG 数据（现代 Windows 支持 PNG 压缩项）
function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, data: Buffer.from(renderPng(s)) }))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = header.length + images.length * 16
  for (const { size, data } of images) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size >= 256 ? 0 : size, 0)
    entry.writeUInt8(size >= 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += data.length
    entries.push(entry)
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)])
}
writeFileSync('resources/icon.ico', buildIco([256, 128, 64, 48, 32, 16]))

// ICNS：'icns' 魔数 + 总长度 + 类型化 PNG 块（ic07=128, ic08=256, ic09=512）
function buildIcns(sizes) {
  const chunks = sizes.map(([type, size]) => {
    const data = Buffer.from(renderPng(size))
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(data.length + 8, 4)
    return Buffer.concat([head, data])
  })
  const body = Buffer.concat(chunks)
  const header = Buffer.alloc(8)
  header.write('icns', 0, 'ascii')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}
writeFileSync('resources/icon.icns', buildIcns([['ic10', 1024], ['ic09', 512], ['ic08', 256], ['ic07', 128], ['icp6', 64], ['icp5', 32], ['icp4', 16]]))

console.log('icons generated: logo.svg / icon.png / icon.ico / icon.icns')
