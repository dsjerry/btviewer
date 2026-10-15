// 轻量更新检查（C7）：读 GitHub Releases API 的最新版本，与本地版本比较。
// 纯函数：网络请求在 main.ts，解析与比较在这里，便于单测。
export interface ReleaseInfo {
  version: string
  url: string
  publishedAt: string
  notes: string
}

export interface UpdateCheckResult extends ReleaseInfo {
  current: string
  hasUpdate: boolean
}

// 'v1.2.3' / '1.2.3-beta.1' → [1,2,3]；预发布后缀不参与比较（视为同版本，避免把 beta 当成更新）
export function normalizeVersion(value: string): number[] {
  const cleaned = String(value || '').trim().replace(/^v/i, '').split(/[-+]/)[0]
  const parts = cleaned.split('.').map((part) => {
    const num = Number(part.replace(/[^\d]/g, ''))
    return Number.isFinite(num) && num > 0 ? num : 0
  })
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

export function isNewerVersion(latest: string, current: string): boolean {
  const a = normalizeVersion(latest)
  const b = normalizeVersion(current)
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true
    if (a[i] < b[i]) return false
  }
  return false
}

// GitHub /releases/latest 的响应；缺 tag_name 视为不可用（例如仓库还没有 Release）
export function parseLatestRelease(json: string): ReleaseInfo | null {
  let parsed: { tag_name?: unknown; name?: unknown; html_url?: unknown; published_at?: unknown; body?: unknown }
  try { parsed = JSON.parse(json) as typeof parsed } catch { return null }
  const tag = typeof parsed.tag_name === 'string' ? parsed.tag_name.trim() : ''
  if (!tag) return null
  return {
    version: tag.replace(/^v/i, ''),
    url: typeof parsed.html_url === 'string' ? parsed.html_url : '',
    publishedAt: typeof parsed.published_at === 'string' ? parsed.published_at : '',
    notes: typeof parsed.body === 'string' ? parsed.body.trim().slice(0, 600) : ''
  }
}
