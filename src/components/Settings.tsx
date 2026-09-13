import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import pkg from '../../package.json'
import type { ThemeMode, UpdaterEvent } from '../types'

interface SettingsState { downloadDir: string; trackers: string; maxConcurrentDownloads: number; speedLimit: string; logDir: string; closeToTray?: boolean; launchOnStartup?: boolean; notifyOnComplete?: boolean }

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

const Settings: React.FC<{ theme: ThemeMode; onThemeChange: (mode: ThemeMode) => void }> = ({ theme, onThemeChange }) => {
  const [state, setState] = useState<SettingsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [checking, setChecking] = useState(false)
  const [updateState, setUpdateState] = useState<UpdaterEvent | null>(null)
  // 输入即校验；有错误时禁用保存
  const speedLimitError = state ? validateSpeedLimit(state.speedLimit) : ''
  const trackersError = state ? validateTrackers(state.trackers) : ''
  const hasValidationError = !!speedLimitError || !!trackersError

  useEffect(() => { try { return ipc.onUpdaterEvent((event) => setUpdateState(event)) } catch { return () => undefined } }, [])

  useEffect(() => {
    void (async () => {
      const result = await ipc.getSettings()
      if (result.success && result.data) {
        setState({
          downloadDir: result.data.downloadDir || '',
          trackers: result.data.trackers || '',
          maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5,
          speedLimit: result.data.speedLimit || '',
          logDir: result.data.logDir || '',
          closeToTray: result.data.closeToTray,
          launchOnStartup: result.data.launchOnStartup,
          notifyOnComplete: result.data.notifyOnComplete
        })
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
      const result = await ipc.saveSettings({ downloadDir: state.downloadDir, trackers: state.trackers, maxConcurrentDownloads: state.maxConcurrentDownloads, speedLimit: limit })
      if (result.success && result.data) {
        setState({ downloadDir: result.data.downloadDir || '', trackers: result.data.trackers || '', maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5, speedLimit: result.data.speedLimit || '', logDir: result.data.logDir || state.logDir })
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
