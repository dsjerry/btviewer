import { describe, expect, it } from 'vitest'
import { collectLaunchInputs, isMagnet, MAX_LAUNCH_INPUTS } from '../electron/launch-inputs'

const magnet = 'magnet:?xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10&dn=Sintel'
const exists = (path: string) => path === 'D:/dl/seed.torrent' || path === '/home/u/影片.metalink'

describe('isMagnet', () => {
  it('只认 magnet:? 开头（大小写不敏感）', () => {
    expect(isMagnet(magnet)).toBe(true)
    expect(isMagnet('MAGNET:?xt=urn:btih:abc')).toBe(true)
    expect(isMagnet('https://example.com/a.torrent')).toBe(false)
    expect(isMagnet('magnet')).toBe(false)
  })
})

describe('collectLaunchInputs', () => {
  it('从命令行里挑出磁力与存在的种子文件', () => {
    const argv = ['C:/Program Files/BTViewer/BTViewer.exe', '--hidden', magnet, 'D:/dl/seed.torrent']
    expect(collectLaunchInputs(argv, exists)).toEqual([magnet, 'D:/dl/seed.torrent'])
  })

  it('跳过开关、入口脚本、可执行文件与不存在的路径', () => {
    const argv = ['electron', '.', '--user-data-dir=C:/tmp/x', 'C:/app/main.js', 'D:/dl/missing.torrent', 'D:/dl/movie.mkv', 'C:/some/dir']
    expect(collectLaunchInputs(argv, exists)).toEqual([])
  })

  it('支持中文文件名的 metalink', () => {
    expect(collectLaunchInputs(['/home/u/影片.metalink'], exists)).toEqual(['/home/u/影片.metalink'])
  })

  it('去重并封顶', () => {
    expect(collectLaunchInputs([magnet, magnet], exists)).toEqual([magnet])
    const many = Array.from({ length: MAX_LAUNCH_INPUTS + 5 }, (_, i) => `magnet:?xt=urn:btih:${String(i).padStart(40, '0')}`)
    expect(collectLaunchInputs(many, exists)).toHaveLength(MAX_LAUNCH_INPUTS)
  })

  it('空参数与空白项被忽略', () => {
    expect(collectLaunchInputs(['', '   ', '--hidden'], exists)).toEqual([])
  })
})
