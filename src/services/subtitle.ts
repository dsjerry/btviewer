// 主进程与渲染层共用的字幕工具：渲染层不能直接 import electron/ 下的模块（会连带打包 electron API）
// SRT 转 WebVTT：补 WEBVTT 头并把时间戳的毫秒分隔逗号改为点；本身已是 VTT 的内容原样返回
export function srtToVtt(content: string) {
  const text = content.replace(/^\uFEFF/, '')
  if (/^\s*WEBVTT/.test(text)) return text
  return `WEBVTT\n\n${text.replace(/(\d{1,2}:\d{2}:\d{2})\s*,\s*(\d{1,3})/g, '$1.$2').trim()}\n`
}
