import type { ThemeMode } from '../types'

const scheme = window.matchMedia('(prefers-color-scheme: dark)')

// 'system' 依据操作系统当前亮暗偏好解析为具体主题
export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return scheme.matches ? 'dark' : 'light'
}

// 把主题写到 <html data-theme> 上，global.css 里的 [data-theme='light'] 覆盖块据此生效
export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolveTheme(mode)
}

// 跟随系统模式下监听系统亮暗切换并实时应用；返回取消监听函数
export function watchSystemTheme(mode: ThemeMode): () => void {
  const handler = () => { if (mode === 'system') applyTheme(mode) }
  scheme.addEventListener('change', handler)
  return () => scheme.removeEventListener('change', handler)
}
