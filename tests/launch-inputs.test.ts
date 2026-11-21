import { describe, expect, it } from 'vitest'
import { collectLaunchInputs, collectMediaLaunchInputs, isMagnet, MAX_LAUNCH_INPUTS, MEDIA_FILE_RE } from '../electron/launch-inputs'

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

describe('collectMediaLaunchInputs', () => {
  // 与 torrent-engine 的 getFileType 白名单保持一致，多认会在导入时被拒
  const mediaExists = (path: string) => path === '/Movies/电影.mp4' || path === '/Movies/剧集.mkv' || path === '/Movies/歌.flac'

  it('挑出确实存在的媒体文件（Finder「打开方式」传入）', () => {
    const argv = ['/Movies/电影.mp4', '/Movies/剧集.mkv', '/Movies/歌.flac', '/Movies/缺失.avi', '/Movies/笔记.txt']
    expect(collectMediaLaunchInputs(argv, mediaExists)).toEqual(['/Movies/电影.mp4', '/Movies/剧集.mkv', '/Movies/歌.flac'])
  })

  it('跳过磁力、种子与开关', () => {
    expect(collectMediaLaunchInputs([magnet, 'D:/dl/seed.torrent', '--hidden'], () => true)).toEqual([])
  })

  it('扩展名大小写不敏感，覆盖视频与音频容器', () => {
    expect(MEDIA_FILE_RE.test('/A/BIG_BUCK_BUNNY.WEBM')).toBe(true)
    expect(MEDIA_FILE_RE.test('/A/movie.M4V')).toBe(true)
    expect(MEDIA_FILE_RE.test('/A/语音.FLAC')).toBe(true)
    expect(MEDIA_FILE_RE.test('/A/notes.txt')).toBe(false)
    expect(MEDIA_FILE_RE.test('/A/无扩展名')).toBe(false)
  })

  it('去重并封顶', () => {
    expect(collectMediaLaunchInputs(['/m/a.mp4', '/m/a.mp4'], () => true)).toEqual(['/m/a.mp4'])
    const many = Array.from({ length: MAX_LAUNCH_INPUTS + 3 }, (_, i) => `/m/v${i}.mp4`)
    expect(collectMediaLaunchInputs(many, () => true)).toHaveLength(MAX_LAUNCH_INPUTS)
  })
})
