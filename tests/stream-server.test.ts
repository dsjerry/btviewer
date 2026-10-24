import { describe, expect, it } from 'vitest'
import { parseByteRange } from '../electron/http-range'
import { buildRangeResponse, getMime, isAttachableSubtitle, isWithinRoot, parseStreamRoute, subtitleExt, tokenMatches } from '../electron/stream-server'

// 流服务是安全边界：token 鉴权 + 目录越界拦截必须穷举覆盖

describe('parseStreamRoute', () => {
  it('识别三种路由', () => {
    expect(parseStreamRoute('/stream/abc123/3')).toEqual({ kind: 'stream', id: 'abc123', fileIndex: '3' })
    expect(parseStreamRoute('/subtitle/abc/2')).toEqual({ kind: 'subtitle', id: 'abc', fileIndex: '2' })
    expect(parseStreamRoute('/compat/session-1')).toEqual({ kind: 'compat', id: 'session-1' })
  })

  it('不认识或形似但多余的路径一律 unknown', () => {
    for (const path of ['/', '/stream', '/stream/abc', '/stream/abc/x', '/stream/abc/1/2', '/stream//1', '/compat/a/b', '/../etc/passwd', '/streamevil/1']) {
      expect(parseStreamRoute(path).kind).toBe('unknown')
    }
  })

  it('百分号编码的哈希会被解码，非法转义不会抛异常', () => {
    expect(parseStreamRoute('/stream/a%20b/1').id).toBe('a b')
    expect(parseStreamRoute('/stream/%E0%A4%A/1').id).toBe('%E0%A4%A')
  })

  it('文件序号必须是数字（拒绝注入式路径段）', () => {
    expect(parseStreamRoute('/stream/abc/%2e%2e').kind).toBe('unknown')
    expect(parseStreamRoute('/stream/abc/1%20').kind).toBe('unknown')
  })
})

describe('tokenMatches', () => {
  it('完全一致才通过', () => {
    expect(tokenMatches('a'.repeat(32), 'a'.repeat(32))).toBe(true)
    expect(tokenMatches('b'.repeat(32), 'a'.repeat(32))).toBe(false)
  })
  it('长度不同、缺少 token 一律拒绝', () => {
    expect(tokenMatches('a'.repeat(31), 'a'.repeat(32))).toBe(false)
    expect(tokenMatches(null, 'a'.repeat(32))).toBe(false)
    expect(tokenMatches('', '')).toBe(false)
    expect(tokenMatches('a'.repeat(32), '')).toBe(false)
  })
})

describe('isWithinRoot', () => {
  const root = '/Users/me/Downloads/task'

  it('root 内的路径通过', () => {
    expect(isWithinRoot(root, '/Users/me/Downloads/task/movie.mkv')).toBe(true)
    expect(isWithinRoot(root, '/Users/me/Downloads/task/sub/a.srt')).toBe(true)
  })

  it('拒绝 ../ 穿越、兄弟目录与前缀相似的目录', () => {
    expect(isWithinRoot(root, '/Users/me/Downloads/task/../../../etc/passwd')).toBe(false)
    expect(isWithinRoot(root, '/Users/me/Downloads/other/movie.mkv')).toBe(false)
    expect(isWithinRoot(root, '/Users/me/Downloads/task-evil/x.mkv')).toBe(false)
    expect(isWithinRoot(root, '/etc/passwd')).toBe(false)
  })

  it('root 自身不算「在其内部」（必须是文件）', () => {
    expect(isWithinRoot(root, root)).toBe(false)
  })
})

describe('字幕与 MIME', () => {
  it('只有 srt/vtt 可以挂载', () => {
    expect(isAttachableSubtitle('/dl/a.SRT')).toBe(true)
    expect(isAttachableSubtitle('/dl/a.vtt')).toBe(true)
    expect(isAttachableSubtitle('/dl/a.ass')).toBe(false)
    expect(isAttachableSubtitle('/dl/noext')).toBe(false)
  })
  it('扩展名解析与 MIME 映射', () => {
    expect(subtitleExt('/dl/a.MKV')).toBe('.mkv')
    expect(getMime('/dl/a.mkv')).toBe('video/x-matroska')
    expect(getMime('/dl/a.vtt')).toContain('text/vtt')
    expect(getMime('/dl/a.unknown')).toBe('application/octet-stream')
  })
})

describe('buildRangeResponse', () => {
  const cors = { 'access-control-allow-origin': '*' }
  const size = 1000

  it('完整请求返回 200 与全量区间', () => {
    const result = buildRangeResponse(parseByteRange(undefined, size), size, '/dl/a.mp4', cors)
    expect(result.status).toBe(200)
    expect(result.headers['content-length']).toBe(1000)
    expect(result.headers['accept-ranges']).toBe('bytes')
    expect(result.body).toEqual({ start: 0, end: 999 })
  })

  it('Range 请求返回 206 与 content-range', () => {
    const result = buildRangeResponse(parseByteRange('bytes=0-99', size), size, '/dl/a.mp4', cors)
    expect(result.status).toBe(206)
    expect(result.headers['content-range']).toBe('bytes 0-99/1000')
    expect(result.body).toEqual({ start: 0, end: 99 })
  })

  it('超出范围返回 416 且不读文件', () => {
    const result = buildRangeResponse(parseByteRange('bytes=5000-', size), size, '/dl/a.mp4', cors)
    expect(result.status).toBe(416)
    expect(result.headers['content-range']).toBe('bytes */1000')
    expect(result.body).toBeNull()
  })

  it('空文件返回 200 空 body，不再走到 createReadStream', () => {
    const result = buildRangeResponse(parseByteRange(undefined, 0), 0, '/dl/a.mp4', cors)
    expect(result.status).toBe(200)
    expect(result.headers['content-length']).toBe(0)
    expect(result.body).toBeNull()
  })
})
