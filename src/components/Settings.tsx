import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import pkg from '../../package.json'
import type { ThemeMode, UpdaterEvent } from '../types'

interface SettingsState { downloadDir: string; trackers: string; maxConcurrentDownloads: number; speedLimit: string; httpSplit: number; ytdlpPath: string; ytdlpBrowser: string; proxy: string; logDir: string; closeToTray?: boolean; launchOnStartup?: boolean; notifyOnComplete?: boolean }

// yt-dlp cookies 来源浏览器（--cookies-from-browser 支持的常见浏览器）；Firefox 最稳定（Chrome/Edge 127+ 有 DPAPI 加密限制）
const BROWSER_OPTIONS = [
  { value: '', label: '不使用 Cookies' },
  { value: 'firefox', label: 'Firefox（推荐）' },
  { value: 'edge', label: 'Edge' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'brave', label: 'Brave' },
  { value: 'vivaldi', label: 'Vivaldi' }
]

const REPO_URL = 'https://github.com/dsjerry/btviewer'

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: string }> = [
  { value: 'light', label: '亮色', icon: '☀' },
  { value: 'dark', label: '暗色', icon: '☾' },
  { value: 'system', label: '跟随系统', icon: '◐' }
]

// 即时校验：返回错误文案，空串表示通过
const SPEED_LIMIT_RE = /^\d+(\.\d+)?[KMG]?$/i
function validateSpeedLimit(value: string): string {
  const limit = value.trim()
  if (!limit || limit === '0') return ''
  return SPEED_LIMIT_RE.test(limit) ? '' : '限速格式无效，示例：10M、512K、0（不限速）'
}
function validateTrackers(value: string): string {
  const list = value.split(/[\s,]+/).filter(Boolean)
  if (!list.length) return ''
  const invalid = list.find((item) => !/^(udp|https?|wss?):\/\//i.test(item))
  return invalid ? `无效 tracker（需以 udp://、http(s):// 或 ws(s):// 开头）：${invalid.slice(0, 60)}` : ''
}
// 代理格式：http(s)://host:port 或 socks4/5://host:port；留空表示不使用
const PROXY_RE = /^(https?|socks4a?|socks5h?):\/\/[^\s]+$/i
function validateProxy(value: string): string {
  const proxy = value.trim()
  if (!proxy) return ''
  return PROXY_RE.test(proxy) ? '' : '代理格式无效，示例：http://127.0.0.1:7890 或 socks5://127.0.0.1:1080'
}

const Settings: React.FC<{ theme: ThemeMode; onThemeChange: (mode: ThemeMode) => void }> = ({ theme, onThemeChange }) => {
  const [state, setState] = useState<SettingsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateState, setUpdateState] = useState<UpdaterEvent | null>(null)
  // yt-dlp 可用性：页面打开时自动检测一次，也可手动重新检测
  const [ytdlpState, setYtdlpState] = useState<{ checking: boolean; available?: boolean; ffmpeg?: boolean; jsRuntime?: { name: string; path: string; version?: string } | null; path?: string }>({ checking: false })
  // yt-dlp 自动安装进度（主进程实时推送）
  const [installProgress, setInstallProgress] = useState<{ received: number; total: number } | null>(null)
  // ffmpeg 自动安装进度
  const [ffmpegProgress, setFfmpegProgress] = useState<{ received: number; total: number } | null>(null)
  // deno（JS 运行时）自动安装进度
  const [denoProgress, setDenoProgress] = useState<{ received: number; total: number } | null>(null)
  // 输入即校验；有错误时禁用保存
  const speedLimitError = state ? validateSpeedLimit(state.speedLimit) : ''
  const trackersError = state ? validateTrackers(state.trackers) : ''
  const proxyError = state ? validateProxy(state.proxy) : ''
  const hasValidationError = !!speedLimitError || !!trackersError || !!proxyError

  useEffect(() => { try { return ipc.onUpdaterEvent((event) => setUpdateState(event)) } catch { return () => undefined } }, [])
  useEffect(() => { try { return ipc.onYtdlpInstallProgress((progress) => setInstallProgress(progress)) } catch { return () => undefined } }, [])
  useEffect(() => { try { return ipc.onFfmpegInstallProgress((progress) => setFfmpegProgress(progress)) } catch { return () => undefined } }, [])
  useEffect(() => { try { return ipc.onDenoInstallProgress((progress) => setDenoProgress(progress)) } catch { return () => undefined } }, [])

  const checkYtdlp = async (path?: string) => {
    setYtdlpState({ checking: true })
    try {
      const result = await ipc.checkYtDlp(path)
      if (result.success && result.data) setYtdlpState({ checking: false, available: result.data.available, ffmpeg: result.data.ffmpegAvailable, jsRuntime: result.data.jsRuntime, path: result.data.path })
      else setYtdlpState({ checking: false, available: false })
    } catch { setYtdlpState({ checking: false, available: false }) }
  }

  const installYtdlp = async () => {
    setInstallProgress({ received: 0, total: 0 })
    try {
      const result = await ipc.installYtDlp()
      if (result.success) { setNotice({ type: 'success', text: 'yt-dlp 安装完成' }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || '安装失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '安装失败' }) } finally { setInstallProgress(null) }
  }

  const updateYtdlp = async () => {
    if (!ytdlpState.path) return
    setYtdlpState((current) => ({ ...current, checking: true }))
    try {
      const result = await ipc.updateYtDlp(ytdlpState.path)
      setNotice(result.success ? { type: 'success', text: result.data || '已是最新版本' } : { type: 'error', text: result.error || '更新失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '更新失败' }) } finally { setYtdlpState((current) => ({ ...current, checking: false })) }
  }

  const installFfmpeg = async () => {
    setFfmpegProgress({ received: 0, total: 0 })
    try {
      const result = await ipc.installFfmpeg()
      if (result.success) { setNotice({ type: 'success', text: 'ffmpeg 就绪，出错的视频任务已自动重试' }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || '安装失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '安装失败' }) } finally { setFfmpegProgress(null) }
  }

  const installDeno = async () => {
    setDenoProgress({ received: 0, total: 0 })
    try {
      const result = await ipc.installDeno()
      if (result.success) { setNotice({ type: 'success', text: 'deno 就绪，YouTube 高画质解析已启用，出错的视频任务已自动重试' }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || '安装失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '安装失败' }) } finally { setDenoProgress(null) }
  }

  useEffect(() => {
    void (async () => {
      const result = await ipc.getSettings()
      if (result.success && result.data) {
        setState({
          downloadDir: result.data.downloadDir || '',
          trackers: result.data.trackers || '',
          maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5,
          speedLimit: result.data.speedLimit || '',
          httpSplit: result.data.httpSplit || 8,
          ytdlpPath: result.data.ytdlpPath || '',
          ytdlpBrowser: result.data.ytdlpBrowser || '',
          proxy: result.data.proxy || '',
          logDir: result.data.logDir || '',
          closeToTray: result.data.closeToTray,
          launchOnStartup: result.data.launchOnStartup,
          notifyOnComplete: result.data.notifyOnComplete
        })
        void checkYtdlp(result.data.ytdlpPath)
      } else {
        setNotice({ type: 'error', text: result.error || '读取设置失败' })
      }
    })()
  }, [])

  const save = async () => {
    if (!state || hasValidationError) return
    const limit = state.speedLimit.trim() || '0'
    setSaving(true); setNotice(null)
    try {
      const result = await ipc.saveSettings({ downloadDir: state.downloadDir, trackers: state.trackers, maxConcurrentDownloads: state.maxConcurrentDownloads, speedLimit: limit, httpSplit: state.httpSplit, ytdlpPath: state.ytdlpPath.trim(), ytdlpBrowser: state.ytdlpBrowser, proxy: state.proxy.trim() })
      if (result.success && result.data) {
        setState({ downloadDir: result.data.downloadDir || '', trackers: result.data.trackers || '', maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5, speedLimit: result.data.speedLimit || '', httpSplit: result.data.httpSplit || 8, ytdlpPath: result.data.ytdlpPath || '', ytdlpBrowser: result.data.ytdlpBrowser || '', proxy: result.data.proxy || '', logDir: result.data.logDir || state.logDir })
        setNotice({ type: 'success', text: '设置已保存并对新任务生效' })
      } else {
        setNotice({ type: 'error', text: result.error || '保存失败' })
      }
    } finally { setSaving(false) }
  }

  // 托盘/自启这类开关立即生效，不等"保存设置"
  const saveOption = async (patch: { closeToTray?: boolean; launchOnStartup?: boolean; notifyOnComplete?: boolean }) => {
    try {
      const result = await ipc.saveSettings(patch)
      if (result.success && result.data) setState((prev) => prev ? { ...prev, closeToTray: result.data?.closeToTray, launchOnStartup: result.data?.launchOnStartup, notifyOnComplete: result.data?.notifyOnComplete } : prev)
      else setNotice({ type: 'error', text: result.error || '保存失败' })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '保存失败' }) }
  }

  const checkNow = async () => {
    setChecking(true); setNotice(null)
    try {
      const result = await ipc.checkForUpdates()
      if (!result.success) { setNotice({ type: 'error', text: result.error || '检查更新失败' }); setUpdateState(null) }
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '检查更新失败' }) } finally { setChecking(false) }
  }

  const updateStatusText = () => {
    if (!updateState) return '启动时会自动检查并后台下载新版本'
    switch (updateState.type) {
      case 'checking': return '正在检查更新…'
      case 'available': return `发现新版本 v${updateState.version}，正在后台下载…`
      case 'progress': return `正在下载新版本… ${updateState.percent ?? 0}%`
      case 'downloaded': return `新版本 v${updateState.version} 已就绪`
      case 'error': return `检查失败：${updateState.message || '网络异常'}`
      default: return '当前已是最新版本'
    }
  }

  const pickDir = async () => {
    const result = await ipc.pickDownloadDir()
    if (result.success && result.data && state) setState({ ...state, downloadDir: result.data })
  }

  const openDir = async () => {
    if (!state?.downloadDir) return
    const result = await ipc.openPath(state.downloadDir)
    if (!result.success) setNotice({ type: 'error', text: result.error || '无法打开目录' })
  }

  const openExternal = async (url: string) => {
    const result = await ipc.openExternal(url)
    if (!result.success) setNotice({ type: 'error', text: result.error || '无法打开链接' })
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow">系统设置</span><h2>设置</h2><p>配置立即保存，对新任务生效；已存在的任务不受影响</p></div>
      </div>
      {!state ? (
        <div className="empty-state"><span>⚙</span><strong>{notice ? notice.text : '正在读取设置…'}</strong></div>
      ) : (
        <>
          <div className="settings-card">
            <h3>外观主题</h3>
            <p>切换立即生效；跟随系统时随操作系统的亮暗偏好自动切换</p>
            <div className="theme-options" role="radiogroup" aria-label="外观主题">
              {THEME_OPTIONS.map((option) => (
                <button key={option.value} className={`theme-option ${theme === option.value ? 'is-active' : ''}`} role="radio" aria-checked={theme === option.value} onClick={() => onThemeChange(option.value)}>
                  <span className="theme-option-icon">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-card">
            <h3>下载目录</h3>
            <p>新任务的保存位置；已存在任务仍使用创建时的目录</p>
            <div className="settings-row">
              <input type="text" value={state.downloadDir} readOnly />
              <button className="small-button" onClick={() => void pickDir()}>更改…</button>
              <button className="small-button" onClick={() => void openDir()}>打开目录</button>
            </div>
          </div>
          <div className="settings-card">
            <h3>窗口行为</h3>
            <p>开关立即生效；最小化到托盘后任务继续后台下载</p>
            <label className="settings-check"><input type="checkbox" checked={state.closeToTray !== false} onChange={(event) => void saveOption({ closeToTray: event.target.checked })} />关闭窗口时最小化到托盘</label>
            <label className="settings-check"><input type="checkbox" checked={!!state.launchOnStartup} onChange={(event) => void saveOption({ launchOnStartup: event.target.checked })} />开机自动启动（静默启动到托盘）</label>
            <label className="settings-check"><input type="checkbox" checked={state.notifyOnComplete !== false} onChange={(event) => void saveOption({ notifyOnComplete: event.target.checked })} />任务下载完成后弹出系统通知</label>
          </div>
          <div className="settings-card">
            <h3>Tracker 列表</h3>
            <p>逗号或空白分隔；留空使用内置公共 tracker（优先级：此处 &gt; ARIA2_TRACKERS 环境变量 &gt; 内置列表）</p>
            <textarea className={`settings-textarea ${trackersError ? 'has-error' : ''}`} rows={4} value={state.trackers} onChange={(event) => setState({ ...state, trackers: event.target.value })} placeholder="udp://tracker.example.org:1337/announce, https://tracker.example.com:443/announce" />
            {trackersError && <p className="field-error">{trackersError}</p>}
          </div>
          <div className="settings-card">
            <h3>最大同时下载数</h3>
            <p>同时处于下载中的任务数量上限</p>
            <div className="settings-row">
              <input type="number" min={1} max={10} value={state.maxConcurrentDownloads} onChange={(event) => setState({ ...state, maxConcurrentDownloads: Number(event.target.value) })} />
            </div>
          </div>
          <div className="settings-card">
            <h3>下载限速</h3>
            <p>全局总速度上限（含正在下载的任务）；0 或留空表示不限速</p>
            <div className="settings-row">
              <input type="text" className={speedLimitError ? 'has-error' : ''} value={state.speedLimit} onChange={(event) => setState({ ...state, speedLimit: event.target.value })} placeholder="例如 10M、512K；0 为不限速" />
            </div>
            {speedLimitError && <p className="field-error">{speedLimitError}</p>}
          </div>
          <div className="settings-card">
            <h3>网络代理</h3>
            <p>用于 HTTP(S)/FTP 直链与视频站点（yt-dlp）下载；BT/DHT 不走代理。访问 YouTube 等站点需要在此填写代理</p>
            <div className="settings-row">
              <input type="text" className={proxyError ? 'has-error' : ''} value={state.proxy} onChange={(event) => setState({ ...state, proxy: event.target.value })} placeholder="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；留空不使用" />
            </div>
            {proxyError && <p className="field-error">{proxyError}</p>}
          </div>
          <div className="settings-card">
            <h3>直链下载</h3>
            <p>HTTP(S)/FTP 任务的每服务器最大连接数（多线程分片加速）；1-16，对新任务生效</p>
            <div className="settings-row">
              <input type="number" min={1} max={16} value={state.httpSplit} onChange={(event) => setState({ ...state, httpSplit: Math.max(1, Math.min(16, Number(event.target.value) || 8)) })} />
            </div>
          </div>
          <div className="settings-card">
            <h3>视频站点解析（yt-dlp）</h3>
            <p>网页类链接自动交给 yt-dlp 解析下载（YouTube、Bilibili 等）；解析 YouTube 高画质需要 JS 运行时（deno），合并分离音视频需要 ffmpeg</p>
            <div className="settings-row">
              <input type="text" value={state.ytdlpPath} onChange={(event) => setState({ ...state, ytdlpPath: event.target.value })} placeholder="留空自动查找（内置安装目录与系统 PATH）" />
              <button className="small-button" onClick={() => void checkYtdlp(state.ytdlpPath.trim() || undefined)} disabled={ytdlpState.checking || !!installProgress}>{ytdlpState.checking ? '检测中…' : '检测可用性'}</button>
            </div>
            {ytdlpState.available === true && (
              <>
                <p className="field-ok">✓ yt-dlp 可用{ytdlpState.path ? `（${ytdlpState.path}）` : ''}{ytdlpState.ffmpeg ? '；已检测到 ffmpeg，支持高画质合并' : '；未检测到 ffmpeg，仅能下载预合并格式'}</p>
                {ytdlpState.jsRuntime
                  ? <p className="field-ok">✓ 已检测到 JS 运行时 {ytdlpState.jsRuntime.name}{ytdlpState.jsRuntime.version ? ` ${ytdlpState.jsRuntime.version}` : ''}，可解 YouTube 签名挑战（高画质必需）</p>
                  : <p className="field-error">未检测到可用的 JS 运行时（需 deno≥2.3 或 node≥22）：yt-dlp 2025+ 解 YouTube 签名挑战需要它，缺失时带 Cookies 会报 Video unavailable / 只能拿 360p。可一键安装 deno</p>}
                <div className="settings-row">
                  {!ytdlpState.jsRuntime && <button className="small-button" onClick={() => void installDeno()} disabled={!!denoProgress}>{denoProgress ? '下载中…' : '⤓ 自动安装 deno（约 40MB）'}</button>}
                  {!ytdlpState.ffmpeg && <button className="small-button" onClick={() => void installFfmpeg()} disabled={!!ffmpegProgress}>{ffmpegProgress ? '下载中…' : '⤓ 自动安装 ffmpeg（约 80MB）'}</button>}
                  <button className="small-button" onClick={() => void updateYtdlp()} disabled={ytdlpState.checking}>检查更新（-U）</button>
                </div>
                {denoProgress && (
                  <div className="install-progress">
                    <span className="bar"><span style={{ width: `${denoProgress.total ? Math.min(100, (denoProgress.received / denoProgress.total) * 100) : 8}%` }} /></span>
                    <small>deno {(denoProgress.received / 1024 / 1024).toFixed(1)} MB{denoProgress.total ? ` / ${(denoProgress.total / 1024 / 1024).toFixed(1)} MB` : ''}</small>
                  </div>
                )}
                {ffmpegProgress && (
                  <div className="install-progress">
                    <span className="bar"><span style={{ width: `${ffmpegProgress.total ? Math.min(100, (ffmpegProgress.received / ffmpegProgress.total) * 100) : 8}%` }} /></span>
                    <small>ffmpeg {(ffmpegProgress.received / 1024 / 1024).toFixed(1)} MB{ffmpegProgress.total ? ` / ${(ffmpegProgress.total / 1024 / 1024).toFixed(1)} MB` : ''}</small>
                  </div>
                )}
              </>
            )}
            {ytdlpState.available === false && (
              <>
                <p className="field-error">未检测到 yt-dlp：可一键自动安装（Windows），或使用 pip install yt-dlp 后重新检测</p>
                <div className="settings-row">
                  <button className="small-button" onClick={() => void installYtdlp()} disabled={!!installProgress}>{installProgress ? '下载中…' : '⤓ 自动安装（官方 Release）'}</button>
                </div>
                {installProgress && (
                  <div className="install-progress">
                    <span className="bar"><span style={{ width: `${installProgress.total ? Math.min(100, (installProgress.received / installProgress.total) * 100) : 8}%` }} /></span>
                    <small>{(installProgress.received / 1024 / 1024).toFixed(1)} MB{installProgress.total ? ` / ${(installProgress.total / 1024 / 1024).toFixed(1)} MB` : ''}</small>
                  </div>
                )}
              </>
            )}
            <label className="settings-label" htmlFor="ytdlp-browser">浏览器 Cookies（YouTube 风控时解锁高画质下载）</label>
            <div className="settings-row">
              <select id="ytdlp-browser" value={state.ytdlpBrowser} onChange={(event) => setState({ ...state, ytdlpBrowser: event.target.value })}>
                {BROWSER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <p className="settings-hint">选择你登录过 YouTube 的浏览器；配置后会自动使用 web_embedded 客户端解析（可拿到 4K），不可用时回退 web_safari（1080p）。读取时需完全退出对应浏览器（Edge/Chrome 常驻后台，请从托盘退出）；Chrome/Edge 127+ 因 app-bound 加密常报 “Failed to decrypt with DPAPI” 读取失败，推荐 Firefox（运行时也能读）。未配置或读取失败时改用匿名会话（同样支持 4K，但部分视频要求登录）</p>
          </div>
          <div className="settings-card">
            <h3>版本更新 <small className="version-tag">v{pkg.version}</small></h3>
            <p>{updateStatusText()}</p>
            <div className="settings-row">
              {updateState?.type === 'downloaded'
                ? <button className="small-button" onClick={() => void ipc.installUpdate()}>重启更新</button>
                : <button className="small-button" onClick={() => void checkNow()} disabled={checking || updateState?.type === 'checking'}>{checking ? '检查中…' : '检查更新'}</button>}
            </div>
          </div>
          <div className="settings-actions">
            <button className="primary-action" onClick={() => void save()} disabled={saving || hasValidationError}>{saving ? '保存中…' : '保存设置'}<span>→</span></button>
            <button className="secondary-action" onClick={() => { if (state?.logDir) void ipc.openPath(state.logDir) }}>打开日志目录</button>
          </div>
          {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
          <div className="about-card">
            <svg className="about-logo" viewBox="0 0 512 512" aria-label="BTViewer"><rect width="512" height="512" rx="112" fill="#1e1f17"/><rect x="151" y="151" width="210" height="210" rx="34" transform="rotate(45 256 256)" fill="#d8f36a"/><path d="M 219 190 L 343 256 L 219 322 Z" fill="#131309"/></svg>
            <div className="about-main">
              <div className="about-title">BTViewer <small>v{pkg.version}</small></div>
              <p>{pkg.description}</p>
              <div className="about-meta">
                <span>作者 <a onClick={() => void openExternal(REPO_URL)} role="button" tabIndex={0}>{pkg.author}</a></span>
                <span>协议 <a onClick={() => void openExternal('https://opensource.org/license/mit')} role="button" tabIndex={0}>{pkg.license}</a></span>
                <span>仓库 <a onClick={() => void openExternal(pkg.repository.url.replace('git+', '').replace('.git', ''))} role="button" tabIndex={0}>GitHub</a></span>
                <span>反馈 <a onClick={() => void openExternal(pkg.bugs.url)} role="button" tabIndex={0}>Issues</a></span>
              </div>
              <div className="about-tech">Electron · React · aria2 · video.js</div>
              <div className="about-disclaimer">本应用仅提供 BitTorrent 下载与播放功能，请仅用于合法授权的内容；使用者需自行承担使用行为的法律责任。</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
export default Settings
