// 生成 macOS DMG 安装窗口的背景图（resources/dmg/background.png + background@2x.png）
// 深色底 + 霓虹辉光，与应用暗色主题一致；文字用仓库内置品牌字体 + 系统 PingFang（中文）。
// 用法：node scripts/generate-dmg-background.mjs
import { writeFileSync, mkdirSync } from 'node:fs'
import { Resvg } from '@resvg/resvg-js'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const fontsDir = join(here, '../src/styles/fonts')
const outDir = join(here, '../resources/dmg')

// 660×400 为 DMG 窗口逻辑尺寸，@2x 是 Retina 渲染尺寸
const W = 660
const H = 400

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101208"/>
      <stop offset="0.55" stop-color="#15180e"/>
      <stop offset="1" stop-color="#0b0d07"/>
    </linearGradient>
    <radialGradient id="glowLeft" cx="0.26" cy="0.65" r="0.4">
      <stop offset="0" stop-color="rgba(216,243,106,0.14)"/>
      <stop offset="0.55" stop-color="rgba(216,243,106,0.05)"/>
      <stop offset="1" stop-color="rgba(216,243,106,0)"/>
    </radialGradient>
    <radialGradient id="glowRight" cx="0.68" cy="0.65" r="0.4">
      <stop offset="0" stop-color="rgba(169,233,108,0.10)"/>
      <stop offset="0.6" stop-color="rgba(169,233,108,0.04)"/>
      <stop offset="1" stop-color="rgba(169,233,108,0)"/>
    </radialGradient>
    <linearGradient id="accentLine" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(216,243,106,0)"/>
      <stop offset="0.5" stop-color="rgba(216,243,106,0.75)"/>
      <stop offset="1" stop-color="rgba(216,243,106,0)"/>
    </linearGradient>
    <linearGradient id="arrow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="rgba(216,243,106,0.1)"/>
      <stop offset="0.5" stop-color="rgba(216,243,106,0.45)"/>
      <stop offset="1" stop-color="rgba(216,243,106,0.1)"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glowLeft)"/>
  <rect width="${W}" height="${H}" fill="url(#glowRight)"/>
  <rect x="${W / 2 - 70}" y="52" width="140" height="2" rx="1" fill="url(#accentLine)"/>
  <text x="${W / 2}" y="96" text-anchor="middle" font-family="Space Grotesk" font-weight="700" font-size="30" letter-spacing="0.5" fill="#f3f0e8">BT<tspan fill="#d8f36a">Viewer</tspan></text>
  <text x="${W / 2}" y="124" text-anchor="middle" font-family="DM Mono" font-size="11" letter-spacing="2" fill="#8f9086">MAGNET · TORRENT · STREAMING</text>
  <!-- 拖放指引：应用（左） → Applications（右） -->
  <path d="M ${W / 2 - 46} 252 L ${W / 2 - 14} 252 M ${W / 2 - 22} 245 L ${W / 2 - 14} 252 L ${W / 2 - 22} 259" fill="none" stroke="url(#arrow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="${W / 2}" y="330" text-anchor="middle" font-family="PingFang SC" font-size="13" fill="#d4d5c7">把 BTViewer 拖到右侧「Applications」完成安装</text>
  <text x="${W / 2}" y="352" text-anchor="middle" font-family="DM Mono" font-size="9.5" letter-spacing="1" fill="#6e7065">FIRST OPEN: RIGHT-CLICK → OPEN</text>
</svg>`

function render(scale) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: W * scale },
    font: {
      loadSystemFonts: true,
      fontFiles: [
        join(fontsDir, 'SpaceGrotesk-var.woff2'),
        join(fontsDir, 'DMMono-400.woff2'),
        join(fontsDir, 'DMMono-500.woff2')
      ]
    }
  }).render().asPng()
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'background.png'), render(1))
writeFileSync(join(outDir, 'background@2x.png'), render(2))
console.log('dmg background generated: resources/dmg/background.png (@2x included)')
