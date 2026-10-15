import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import type { LogEntry, LogFileInfo } from '../services/ipc'
import { t } from '../services/i18n'
import pkg from '../../package.json'
import { validateListenPort, validateRetries, validateSeedMinutes, validateSeedRatio, validateSizeLimit } from '../services/validate'
import { POST_ACTION_LABELS } from '../../electron/post-action'
import type { AppSettings, EngineNetworkStatus, Language, PostAction, ThemeMode } from '../types'

interface SettingsState { downloadDir: string; trackers: string; maxConcurrentDownloads: number; speedLimit: string; httpSplit: number; ytdlpPath: string; ytdlpBrowser: string; proxy: string; logDir: string; closeToTray?: boolean; launchOnStartup?: boolean; notifyOnComplete?: boolean; registerMagnet?: boolean; clipboardWatch?: boolean; postAction: PostAction; listenPort: string; enableDht: boolean; enablePex: boolean; enableLpd: boolean; btEncryption: 'auto' | 'require'; seedMode: 'off' | 'ratio' | 'time'; seedRatio: number; seedMinutes: number; streamPriority: boolean; autoRetry: boolean; maxRetries: number }

// 主进程返回的设置 → 组件状态（缺省值集中在一处，避免加载/保存两条路径漂移）
function toState(data: AppSettings, fallback: { logDir: string }): SettingsState {
  return {
    downloadDir: data.downloadDir || '',
    trackers: data.trackers || '',
    maxConcurrentDownloads: data.maxConcurrentDownloads || 5,
    speedLimit: data.speedLimit || '',
    httpSplit: data.httpSplit || 8,
    ytdlpPath: data.ytdlpPath || '',
    ytdlpBrowser: data.ytdlpBrowser || '',
    proxy: data.proxy || '',
    logDir: data.logDir || fallback.logDir,
    closeToTray: data.closeToTray,
    launchOnStartup: data.launchOnStartup,
    notifyOnComplete: data.notifyOnComplete,
    registerMagnet: data.registerMagnet === true,
    clipboardWatch: data.clipboardWatch === true,
    postAction: data.postAction && data.postAction in POST_ACTION_LABELS ? data.postAction : 'none',
    listenPort: data.listenPort || '',
    enableDht: data.enableDht !== false,
    enablePex: data.enablePex !== false,
    enableLpd: data.enableLpd !== false,
    btEncryption: data.btEncryption === 'require' ? 'require' : 'auto',
    seedMode: data.seedMode === 'ratio' || data.seedMode === 'time' ? data.seedMode : 'off',
    seedRatio: Number.isFinite(data.seedRatio) ? Number(data.seedRatio) : 1,
    seedMinutes: Number.isFinite(data.seedMinutes) ? Number(data.seedMinutes) : 60,
    streamPriority: data.streamPriority !== false,
    autoRetry: data.autoRetry !== false,
    maxRetries: Number.isFinite(data.maxRetries) ? Number(data.maxRetries) : 3
  }
}

// yt-dlp cookies 来源浏览器（--cookies-from-browser 支持的常见浏览器）；Firefox 最稳定（Chrome/Edge 127+ 有 DPAPI 加密限制）
// 这些选项含需要翻译的文案：必须是「渲染时求值的函数」，写成模块级常量会在导入时就冻结语言
const browserOptions = () => [
  { value: '', label: t('settings.cookiesNone') },
  { value: 'firefox', label: t('settings.cookiesFirefox') },
  { value: 'edge', label: 'Edge' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'brave', label: 'Brave' },
  { value: 'vivaldi', label: 'Vivaldi' }
]

const REPO_URL = 'https://github.com/dsjerry/btviewer'
// 版本更新改为跳转 GitHub Releases：由用户自行查看新版本与更新说明
const RELEASES_URL = `${REPO_URL}/releases/latest`

const themeOptions = (): Array<{ value: ThemeMode; label: string; icon: string }> => [
  { value: 'light', label: t('settings.themeLight'), icon: '☀' },
  { value: 'dark', label: t('settings.themeDark'), icon: '☾' },
  { value: 'system', label: t('settings.themeSystem'), icon: '◐' }
]

const LANGUAGE_OPTIONS: Array<{ value: Language; label: string; icon: string }> = [
  { value: 'zh', label: '简体中文', icon: '文' },
  { value: 'en', label: 'English', icon: 'A' }
]

// 即时校验：返回错误文案，空串表示通过
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
  return PROXY_RE.test(proxy) ? '' : t('settings.proxyInvalid')
}

const Settings: React.FC<{ theme: ThemeMode; onThemeChange: (mode: ThemeMode) => void; language: Language; onLanguageChange: (language: Language) => void }> = ({ theme, onThemeChange, language, onLanguageChange }) => {
  const [state, setState] = useState<SettingsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  // yt-dlp 可用性：页面打开时自动检测一次，也可手动重新检测
  const [ytdlpState, setYtdlpState] = useState<{ checking: boolean; available?: boolean; ffmpeg?: boolean; jsRuntime?: { name: string; path: string; version?: string } | null; path?: string }>({ checking: false })
  // yt-dlp 自动安装进度（主进程实时推送）
  const [installProgress, setInstallProgress] = useState<{ received: number; total: number } | null>(null)
  // ffmpeg 自动安装进度
  const [ffmpegProgress, setFfmpegProgress] = useState<{ received: number; total: number } | null>(null)
  // deno（JS 运行时）自动安装进度
  const [denoProgress, setDenoProgress] = useState<{ received: number; total: number } | null>(null)
  // 下载引擎网络状态（监听端口 / 是否需要重启生效）
  const [network, setNetwork] = useState<EngineNetworkStatus | null>(null)
  const [restarting, setRestarting] = useState(false)
  // 输入即校验；有错误时禁用保存
  const speedLimitError = state ? validateSizeLimit(state.speedLimit) : ''
  const trackersError = state ? validateTrackers(state.trackers) : ''
  const proxyError = state ? validateProxy(state.proxy) : ''
  const listenPortError = state ? validateListenPort(state.listenPort) : ''
  const seedRatioError = state && state.seedMode === 'ratio' ? validateSeedRatio(state.seedRatio) : ''
  const seedMinutesError = state && state.seedMode === 'time' ? validateSeedMinutes(state.seedMinutes) : ''
  const retriesError = state && state.autoRetry ? validateRetries(state.maxRetries) : ''
  const hasValidationError = !!speedLimitError || !!trackersError || !!proxyError || !!listenPortError || !!seedRatioError || !!seedMinutesError || !!retriesError

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
      if (result.success) { setNotice({ type: 'success', text: t('settings.ytdlpInstalled') }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || t('settings.installFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.installFailed') }) } finally { setInstallProgress(null) }
  }

  const updateYtdlp = async () => {
    if (!ytdlpState.path) return
    setYtdlpState((current) => ({ ...current, checking: true }))
    try {
      const result = await ipc.updateYtDlp(ytdlpState.path)
      setNotice(result.success ? { type: 'success', text: result.data || t('settings.upToDate') } : { type: 'error', text: result.error || t('settings.updateFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.updateFailed') }) } finally { setYtdlpState((current) => ({ ...current, checking: false })) }
  }

  const installFfmpeg = async () => {
    setFfmpegProgress({ received: 0, total: 0 })
    try {
      const result = await ipc.installFfmpeg()
      if (result.success) { setNotice({ type: 'success', text: t('settings.ffmpegReady') }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || t('settings.installFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.installFailed') }) } finally { setFfmpegProgress(null) }
  }

  const installDeno = async () => {
    setDenoProgress({ received: 0, total: 0 })
    try {
      const result = await ipc.installDeno()
      if (result.success) { setNotice({ type: 'success', text: t('settings.denoReady') }); await checkYtdlp(state?.ytdlpPath || undefined) }
      else setNotice({ type: 'error', text: result.error || t('settings.installFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.installFailed') }) } finally { setDenoProgress(null) }
  }

  // 引擎状态：监听端口是否生效、是否需要重启
  const refreshNetwork = async () => {
    const result = await ipc.networkStatus().catch(() => null)
    if (result?.success && result.data) setNetwork(result.data)
  }

  useEffect(() => {
    void (async () => {
      const result = await ipc.getSettings()
      if (result.success && result.data) {
        setState(toState(result.data, { logDir: '' }))
        void checkYtdlp(result.data.ytdlpPath)
      } else {
        setNotice({ type: 'error', text: result.error || t('settings.loadFailed') })
      }
      void refreshNetwork()
      // 日志读取写成自包含逻辑：refreshLogs 依赖当前选中的文件，放进依赖会形成循环
      void (async () => {
        const files = await ipc.listLogs().catch(() => null)
        if (files?.success && files.data) setLogFiles(files.data)
        const result = await ipc.readLogs(600).catch(() => null)
        if (result?.success && result.data) { setLogEntries(result.data.entries); setLogFile(result.data.name) }
      })()
    })()
  }, [])

  const save = async () => {
    if (!state || hasValidationError) return
    const limit = state.speedLimit.trim() || '0'
    setSaving(true); setNotice(null)
    try {
      const result = await ipc.saveSettings({ downloadDir: state.downloadDir, trackers: state.trackers, maxConcurrentDownloads: state.maxConcurrentDownloads, speedLimit: limit, httpSplit: state.httpSplit, ytdlpPath: state.ytdlpPath.trim(), ytdlpBrowser: state.ytdlpBrowser, proxy: state.proxy.trim(), listenPort: state.listenPort.trim(), seedMode: state.seedMode, seedRatio: state.seedRatio, seedMinutes: state.seedMinutes, maxRetries: state.maxRetries })
      if (result.success && result.data) {
        setState(toState(result.data, state))
        setNotice({ type: 'success', text: t('settings.saved') })
      } else {
        setNotice({ type: 'error', text: result.error || t('settings.saveFailed') })
      }
    } finally { setSaving(false) }
  }

  // 开关类设置立即生效，不等「保存设置」；网络类选项改动后引擎会标记「需重启」
  const saveOption = async (patch: Partial<AppSettings>) => {
    try {
      const result = await ipc.saveSettings(patch)
      if (result.success && result.data) {
        setState((prev) => prev ? toState(result.data as AppSettings, prev) : prev)
        if ('listenPort' in patch || 'enableDht' in patch || 'enablePex' in patch || 'enableLpd' in patch || 'btEncryption' in patch) void refreshNetwork()
      } else setNotice({ type: 'error', text: result.error || t('settings.saveFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.saveFailed') }) }
  }

  // 网络类选项（监听端口/DHT/PEX/LPD/加密）是 aria2 命令行参数，改完必须重启引擎
  const restartEngine = async () => {
    setRestarting(true); setNotice(null)
    try {
      const result = await ipc.restartEngine()
      if (result.success) { setNotice({ type: 'success', text: t('settings.engineRestarted') }); await refreshNetwork() }
      else setNotice({ type: 'error', text: result.error || t('settings.restartFailed') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.restartFailed') }) } finally { setRestarting(false) }
  }

  const pickDir = async () => {
    const result = await ipc.pickDownloadDir()
    if (result.success && result.data && state) setState({ ...state, downloadDir: result.data })
  }

  const openDir = async () => {
    if (!state?.downloadDir) return
    const result = await ipc.openPath(state.downloadDir)
    if (!result.success) setNotice({ type: 'error', text: result.error || t('settings.openDirFailed') })
  }

  const openExternal = async (url: string) => {
    const result = await ipc.openExternal(url)
    if (!result.success) setNotice({ type: 'error', text: result.error || t('settings.openLinkFailed') })
  }

  // 运行日志与诊断（C5）
  const [logFiles, setLogFiles] = useState<LogFileInfo[]>([])
  const [logFile, setLogFile] = useState('')
  const [logEntries, setLogEntries] = useState<LogEntry[]>([])
  const [logLevel, setLogLevel] = useState<'all' | 'ERROR' | 'WARN' | 'INFO'>('all')
  const [logLoading, setLogLoading] = useState(false)

  const refreshLogs = async (fileName?: string) => {
    setLogLoading(true)
    try {
      const files = await ipc.listLogs().catch(() => null)
      if (files?.success && files.data) setLogFiles(files.data)
      const target = fileName || logFile || files?.data?.[0]?.name
      const result = await ipc.readLogs(600, target || undefined).catch(() => null)
      if (result?.success && result.data) { setLogEntries(result.data.entries); setLogFile(result.data.name) }
    } finally { setLogLoading(false) }
  }

  const copyDiagnostics = async () => {
    setNotice(null)
    try {
      const result = await ipc.getDiagnostics()
      if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || t('settings.diagnosticsFailed') }); return }
      await navigator.clipboard.writeText(result.data)
      setNotice({ type: 'success', text: t('settings.diagnosticsCopied') })
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : t('settings.copyFailed') }) }
  }

  const visibleLogs = logEntries.filter((entry) => logLevel === 'all' || entry.level === logLevel || (logLevel === 'WARN' && entry.level === 'ERROR'))

  // 轻量更新检查（C7）：只查版本号，不自动下载
  const [updateInfo, setUpdateInfo] = useState<{ state: 'idle' | 'checking' | 'done' | 'error'; message: string; url: string; notes: string }>({ state: 'idle', message: '', url: '', notes: '' })
  const checkLatestRelease = async () => {
    setUpdateInfo({ state: 'checking', message: t('settings.checkingRelease'), url: '', notes: '' })
    const result = await ipc.checkLatestRelease().catch(() => null)
    if (!result?.success || !result.data) {
      setUpdateInfo({ state: 'error', message: result?.error || t('settings.checkFailed'), url: RELEASES_URL, notes: '' })
      return
    }
    const { hasUpdate, version, url, notes } = result.data
    setUpdateInfo(hasUpdate
      ? { state: 'done', message: `发现新版本 v${version}`, url: url || RELEASES_URL, notes }
      : { state: 'done', message: t('settings.latestVersion', { version: result.data.current }), url: RELEASES_URL, notes: '' })
  }

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow">{t('settings.eyebrow')}</span><h2>{t('settings.title')}</h2><p>{t('settings.subtitle')}</p></div>
      </div>
      {!state ? (
        <div className="empty-state"><span>⚙</span><strong>{notice ? notice.text : t('settings.loadingSettings')}</strong></div>
      ) : (
        <>
          <div className="settings-card">
            <h3>{t('settings.appearance')}</h3>
            <p>{t('settings.appearanceHint')}</p>
            <div className="theme-options" role="radiogroup" aria-label="外观主题">
              {themeOptions().map((option) => (
                <button key={option.value} className={`theme-option ${theme === option.value ? 'is-active' : ''}`} role="radio" aria-checked={theme === option.value} onClick={() => onThemeChange(option.value)}>
                  <span className="theme-option-icon">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-card">
            <h3>{language === 'en' ? 'Language' : '界面语言'}</h3>
            <p>{language === 'en' ? 'Switching takes effect immediately and is saved for the next launch.' : '切换立即生效，并会记住到下次启动'}</p>
            <div className="theme-options" role="radiogroup" aria-label="界面语言">
              {LANGUAGE_OPTIONS.map((option) => (
                <button key={option.value} className={`theme-option ${language === option.value ? 'is-active' : ''}`} role="radio" aria-checked={language === option.value} onClick={() => onLanguageChange(option.value)}>
                  <span className="theme-option-icon">{option.icon}</span>
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-card">
            <h3>{t('settings.downloadDir')}</h3>
            <p>{t('settings.downloadDirHint')}</p>
            <div className="settings-row">
              <input type="text" value={state.downloadDir} readOnly />
              <button className="small-button" onClick={() => void pickDir()}>{t('settings.change')}</button>
              <button className="small-button" onClick={() => void openDir()}>{t('settings.openDir')}</button>
            </div>
          </div>
          <div className="settings-card">
            <h3>{t('settings.window')}</h3>
            <p>{t('settings.windowHint')}</p>
            <label className="settings-check"><input type="checkbox" checked={state.closeToTray !== false} onChange={(event) => void saveOption({ closeToTray: event.target.checked })} />{t('settings.closeToTray')}</label>
            <label className="settings-check"><input type="checkbox" checked={!!state.launchOnStartup} onChange={(event) => void saveOption({ launchOnStartup: event.target.checked })} />{t('settings.launchOnStartup')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.notifyOnComplete !== false} onChange={(event) => void saveOption({ notifyOnComplete: event.target.checked })} />{t('settings.notify')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.registerMagnet === true} onChange={(event) => void saveOption({ registerMagnet: event.target.checked })} />{t('settings.registerMagnet')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.clipboardWatch === true} onChange={(event) => void saveOption({ clipboardWatch: event.target.checked })} />{t('settings.clipboardWatch')}</label>
            <div className="settings-label-row"><label className="settings-label" htmlFor="post-action">{t('settings.postAction')}</label></div>
            <div className="settings-row">
              <select id="post-action" value={state.postAction} onChange={(event) => void saveOption({ postAction: event.target.value as PostAction })}>
                {(Object.keys(POST_ACTION_LABELS) as PostAction[]).map((value) => <option key={value} value={value}>{POST_ACTION_LABELS[value]}</option>)}
              </select>
            </div>
            <p>{t('settings.postActionHint')}</p>
          </div>
          <div className="settings-card">
            <h3>{t('settings.trackers')}</h3>
            <p>{t('settings.trackersHint')}</p>
            <textarea className={`settings-textarea ${trackersError ? 'has-error' : ''}`} rows={4} value={state.trackers} onChange={(event) => setState({ ...state, trackers: event.target.value })} placeholder="udp://tracker.example.org:1337/announce, https://tracker.example.com:443/announce" />
            {trackersError && <p className="field-error">{trackersError}</p>}
          </div>
          <div className="settings-card">
            <h3>{t('settings.maxConcurrent')}</h3>
            <p>{t('settings.maxConcurrentHint')}</p>
            <div className="settings-row">
              <input type="number" min={1} max={10} value={state.maxConcurrentDownloads} onChange={(event) => setState({ ...state, maxConcurrentDownloads: Number(event.target.value) })} />
            </div>
          </div>
          <div className="settings-card">
            <h3>{t('settings.speedLimit')}</h3>
            <p>{t('settings.speedLimitHint')}</p>
            <div className="settings-row">
              <input type="text" className={speedLimitError ? 'has-error' : ''} value={state.speedLimit} onChange={(event) => setState({ ...state, speedLimit: event.target.value })} placeholder="例如 10M、512K；0 为不限速" />
            </div>
            {speedLimitError && <p className="field-error">{speedLimitError}</p>}
          </div>
          <div className="settings-card">
            <h3>{t('settings.proxy')}</h3>
            <p>{t('settings.proxyHint')}</p>
            <div className="settings-row">
              <input type="text" className={proxyError ? 'has-error' : ''} value={state.proxy} onChange={(event) => setState({ ...state, proxy: event.target.value })} placeholder="例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080；留空不使用" />
            </div>
            {proxyError && <p className="field-error">{proxyError}</p>}
          </div>
          <div className="settings-card">
            <h3>{t('settings.direct')}</h3>
            <p>{t('settings.directHint')}</p>
            <div className="settings-row">
              <input type="number" min={1} max={16} value={state.httpSplit} onChange={(event) => setState({ ...state, httpSplit: Math.max(1, Math.min(16, Number(event.target.value) || 8)) })} />
            </div>
          </div>
          <div className="settings-card settings-card-tooltip">
            <h3>{t('settings.ytdlp')}</h3>
            <p>{t('settings.ytdlpHint')}</p>
            <div className="settings-row">
              <input type="text" value={state.ytdlpPath} onChange={(event) => setState({ ...state, ytdlpPath: event.target.value })} placeholder="留空自动查找（内置安装目录与系统 PATH）" />
              <button className="small-button" onClick={() => void checkYtdlp(state.ytdlpPath.trim() || undefined)} disabled={ytdlpState.checking || !!installProgress}>{ytdlpState.checking ? t('settings.detecting') : t('settings.detectAvailability')}</button>
            </div>
            {ytdlpState.available === true && (
              <>
                <p className="field-ok">{t('settings.ytdlpReady', { path: ytdlpState.path ? t('settings.ytdlpPathSuffix', { path: ytdlpState.path }) : '', ffmpeg: ytdlpState.ffmpeg ? t('settings.ffmpegOk') : t('settings.ffmpegMissing') })}</p>
                {ytdlpState.jsRuntime
                  ? <p className="field-ok">✓ 已检测到 JS 运行时 {ytdlpState.jsRuntime.name}{ytdlpState.jsRuntime.version ? ` ${ytdlpState.jsRuntime.version}` : ''}，可解 YouTube 签名挑战（高画质必需）</p>
                  : <p className="field-error">{t('settings.noJsRuntime')}</p>}
                <div className="settings-row">
                  {!ytdlpState.jsRuntime && <button className="small-button" onClick={() => void installDeno()} disabled={!!denoProgress}>{denoProgress ? t('settings.downloading') : t('settings.installDeno')}</button>}
                  {!ytdlpState.ffmpeg && <button className="small-button" onClick={() => void installFfmpeg()} disabled={!!ffmpegProgress}>{ffmpegProgress ? t('settings.downloading') : t('settings.installFfmpeg')}</button>}
                  <button className="small-button" onClick={() => void updateYtdlp()} disabled={ytdlpState.checking}>{t('settings.checkYtdlpUpdate')}</button>
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
                <p className="field-error">{t('settings.noYtdlp')}</p>
                <div className="settings-row">
                  <button className="small-button" onClick={() => void installYtdlp()} disabled={!!installProgress}>{installProgress ? t('settings.downloading') : t('settings.installYtdlp')}</button>
                </div>
                {installProgress && (
                  <div className="install-progress">
                    <span className="bar"><span style={{ width: `${installProgress.total ? Math.min(100, (installProgress.received / installProgress.total) * 100) : 8}%` }} /></span>
                    <small>{(installProgress.received / 1024 / 1024).toFixed(1)} MB{installProgress.total ? ` / ${(installProgress.total / 1024 / 1024).toFixed(1)} MB` : ''}</small>
                  </div>
                )}
              </>
            )}
            <div className="settings-label-row">
              <label className="settings-label" htmlFor="ytdlp-browser">{t('settings.cookiesBrowser')}</label>
              <span className="settings-help">
                <button type="button" className="settings-help-trigger" aria-label="浏览器 Cookies 使用说明" aria-describedby="ytdlp-cookie-help">?</button>
                <span id="ytdlp-cookie-help" className="settings-help-tooltip" role="tooltip">{t('settings.cookieHelp')}</span>
              </span>
            </div>
            <div className="settings-row">
              <select id="ytdlp-browser" value={state.ytdlpBrowser} onChange={(event) => setState({ ...state, ytdlpBrowser: event.target.value })}>
                {browserOptions().map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
          </div>
          <div className="settings-card">
            <h3>{t('settings.network')}</h3>
            <p>{t('settings.networkHint')}</p>
            <div className="settings-label-row"><label className="settings-label" htmlFor="listen-port">{t('settings.listenPort')}</label></div>
            <div className="settings-row">
              <input id="listen-port" type="text" className={listenPortError ? 'has-error' : ''} value={state.listenPort} onChange={(event) => setState({ ...state, listenPort: event.target.value })} placeholder="例如 6881 或 6881-6999；留空使用 aria2 默认" />
            </div>
            {listenPortError && <p className="field-error">{listenPortError}</p>}
            <label className="settings-check"><input type="checkbox" checked={state.enableDht} onChange={(event) => void saveOption({ enableDht: event.target.checked })} />{t('settings.dht')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.enablePex} onChange={(event) => void saveOption({ enablePex: event.target.checked })} />{t('settings.pex')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.enableLpd} onChange={(event) => void saveOption({ enableLpd: event.target.checked })} />{t('settings.lpd')}</label>
            <div className="settings-row">
              <select value={state.btEncryption} onChange={(event) => void saveOption({ btEncryption: event.target.value === 'require' ? 'require' : 'auto' })}>
                <option value="auto">{t('settings.encryptionAuto')}</option>
                <option value="require">{t('settings.encryptionRequire')}</option>
              </select>
            </div>
            <p>{network ? `${t('settings.engineLabel')}${network.running ? t('settings.engineRunning', { version: network.version || '' }) : t('settings.engineStopped')}${network.actualPort ? t('settings.enginePort', { port: network.actualPort }) : network.running ? t('settings.enginePortUnknown') : ''}${network.restartRequired ? t('settings.engineRestartPending') : ''}` : t('settings.engineLoading')}</p>
            <div className="settings-row">
              <button className="small-button" onClick={() => void restartEngine()} disabled={restarting}>{restarting ? t('settings.restarting') : t('settings.restartEngine')}</button>
            </div>
          </div>
          <div className="settings-card">
            <h3>{t('settings.seeding')}</h3>
            <p>{t('settings.seedingHint')}</p>
            <div className="settings-row">
              <select value={state.seedMode} onChange={(event) => setState({ ...state, seedMode: event.target.value as 'off' | 'ratio' | 'time' })}>
                <option value="off">{t('settings.seedOff')}</option>
                <option value="ratio">{t('settings.seedRatio')}</option>
                <option value="time">{t('settings.seedTime')}</option>
              </select>
            </div>
            {state.seedMode === 'ratio' && (
              <>
                <div className="settings-row">
                  <input type="number" min={0} max={100} step={0.1} className={seedRatioError ? 'has-error' : ''} value={state.seedRatio} onChange={(event) => setState({ ...state, seedRatio: Number(event.target.value) })} />
                  <span className="settings-unit">{t('settings.unitRatio')}</span>
                </div>
                {seedRatioError && <p className="field-error">{seedRatioError}</p>}
              </>
            )}
            {state.seedMode === 'time' && (
              <>
                <div className="settings-row">
                  <input type="number" min={1} max={43200} className={seedMinutesError ? 'has-error' : ''} value={state.seedMinutes} onChange={(event) => setState({ ...state, seedMinutes: Number(event.target.value) })} />
                  <span className="settings-unit">{t('settings.unitMinutes')}</span>
                </div>
                {seedMinutesError && <p className="field-error">{seedMinutesError}</p>}
              </>
            )}
            <label className="settings-check"><input type="checkbox" checked={state.streamPriority} onChange={(event) => void saveOption({ streamPriority: event.target.checked })} />{t('settings.streamPriority')}</label>
            <label className="settings-check"><input type="checkbox" checked={state.autoRetry} onChange={(event) => void saveOption({ autoRetry: event.target.checked })} />{t('settings.autoRetry')}</label>
            {state.autoRetry && (
              <>
                <div className="settings-row">
                  <input type="number" min={0} max={10} className={retriesError ? 'has-error' : ''} value={state.maxRetries} onChange={(event) => setState({ ...state, maxRetries: Number(event.target.value) })} />
                  <span className="settings-unit">{t('settings.unitRetries')}</span>
                </div>
                {retriesError && <p className="field-error">{retriesError}</p>}
              </>
            )}
          </div>
          <div className="settings-card">
            <h3>{t('settings.logs')}</h3>
            <p>{t('settings.logsHint')}</p>
            <div className="settings-row log-tools">
              <select value={logFile} onChange={(event) => { setLogFile(event.target.value); void refreshLogs(event.target.value) }} aria-label="日志文件">
                {logFiles.length ? logFiles.map((file) => <option key={file.name} value={file.name}>{file.name}（{(file.size / 1024).toFixed(1)} KB）</option>) : <option value="">{t('settings.noLogs')}</option>}
              </select>
              <select value={logLevel} onChange={(event) => setLogLevel(event.target.value as 'all' | 'ERROR' | 'WARN' | 'INFO')} aria-label="日志级别">
                <option value="all">{t('settings.levelAll')}</option>
                <option value="ERROR">{t('settings.levelError')}</option>
                <option value="WARN">{t('settings.levelWarn')}</option>
                <option value="INFO">{t('settings.levelInfo')}</option>
              </select>
              <button className="small-button" onClick={() => void refreshLogs()} disabled={logLoading}>{logLoading ? t('settings.reading') : t('settings.refresh')}</button>
            </div>
            <div className="log-view">
              {visibleLogs.length ? visibleLogs.map((entry, index) => (
                <div className={`log-line ${entry.level.toLowerCase()}`} key={`${index}-${entry.raw.slice(0, 24)}`}>
                  <span className="log-time">{entry.time ? entry.time.slice(11, 19) : '--:--:--'}</span>
                  <span className="log-level">{entry.level}</span>
                  <span className="log-tag">{entry.tag}</span>
                  <span className="log-message" title={entry.message}>{entry.message}</span>
                </div>
              )) : <div className="log-empty">{logEntries.length ? t('settings.noLogsAtLevel') : t('settings.noLogContent')}</div>}
            </div>
            <div className="settings-row">
              <button className="small-button" onClick={() => void refreshLogs()}>{t('settings.reloadLogs')}</button>
              <button className="small-button" onClick={() => { if (state?.logDir) void ipc.openPath(state.logDir) }}>{t('settings.openLogDir')}</button>
              <button className="small-button" onClick={() => void copyDiagnostics()}>{t('settings.copyDiagnostics')}</button>
            </div>
          </div>
          <div className="settings-card">
            <h3>版本更新 <small className="version-tag">v{pkg.version}</small></h3>
            <p>{t('settings.updateHint')}</p>
            <div className="settings-row">
              <button className="small-button" onClick={() => void checkLatestRelease()} disabled={updateInfo.state === 'checking'}>{updateInfo.state === 'checking' ? t('settings.checking') : t('settings.checkUpdates')}</button>
              <button className="small-button" onClick={() => void openExternal(updateInfo.url || RELEASES_URL)}>{t('settings.openReleases')}</button>
            </div>
            {updateInfo.state !== 'idle' && updateInfo.state !== 'checking' && (
              <p className={updateInfo.state === 'error' ? 'field-error' : 'field-ok'}>
                {updateInfo.message}
                {updateInfo.notes ? `：${updateInfo.notes.split('\n')[0].slice(0, 80)}` : ''}
              </p>
            )}
          </div>
          <div className="settings-actions">
            <button className="primary-action" onClick={() => void save()} disabled={saving || hasValidationError}>{saving ? t('settings.saving') : t('settings.save')}<span>→</span></button>
            <button className="secondary-action" onClick={() => { if (state?.logDir) void ipc.openPath(state.logDir) }}>打开日志目录</button>
          </div>
          {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
          <div className="about-card">
            <svg className="about-logo" viewBox="0 0 512 512" aria-label="BTViewer"><rect width="512" height="512" rx="112" fill="#1e1f17"/><rect x="151" y="151" width="210" height="210" rx="34" transform="rotate(45 256 256)" fill="#d8f36a"/><path d="M 219 190 L 343 256 L 219 322 Z" fill="#131309"/></svg>
            <div className="about-main">
              <div className="about-title">BTViewer <small>v{pkg.version}</small></div>
              <p>{pkg.description}</p>
              <div className="about-meta">
                <span>{t('settings.author')} <a onClick={() => void openExternal(REPO_URL)} role="button" tabIndex={0}>{pkg.author.name}</a></span>
                <span>{t('settings.license')} <a onClick={() => void openExternal('https://opensource.org/license/mit')} role="button" tabIndex={0}>{pkg.license}</a></span>
                <span>{t('settings.repo')} <a onClick={() => void openExternal(pkg.repository.url.replace('git+', '').replace('.git', ''))} role="button" tabIndex={0}>GitHub</a></span>
                <span>{t('settings.feedback')} <a onClick={() => void openExternal(pkg.bugs.url)} role="button" tabIndex={0}>Issues</a></span>
              </div>
              <div className="about-tech">Electron · React · aria2 · video.js</div>
              <div className="about-disclaimer">{t('settings.disclaimer')}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
export default Settings
