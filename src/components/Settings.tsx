import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'

interface SettingsState { downloadDir: string; trackers: string; maxConcurrentDownloads: number }

const Settings: React.FC = () => {
  const [state, setState] = useState<SettingsState | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    void (async () => {
      const result = await ipc.getSettings()
      if (result.success && result.data) {
        setState({
          downloadDir: result.data.downloadDir || '',
          trackers: result.data.trackers || '',
          maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5
        })
      } else {
        setNotice({ type: 'error', text: result.error || '读取设置失败' })
      }
    })()
  }, [])

  const save = async () => {
    if (!state) return
    setSaving(true); setNotice(null)
    try {
      const result = await ipc.saveSettings({ downloadDir: state.downloadDir, trackers: state.trackers, maxConcurrentDownloads: state.maxConcurrentDownloads })
      if (result.success && result.data) {
        setState({ downloadDir: result.data.downloadDir || '', trackers: result.data.trackers || '', maxConcurrentDownloads: result.data.maxConcurrentDownloads || 5 })
        setNotice({ type: 'success', text: '设置已保存并对新任务生效' })
      } else {
        setNotice({ type: 'error', text: result.error || '保存失败' })
      }
    } finally { setSaving(false) }
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

  return (
    <div className="page-content">
      <div className="page-heading">
        <div><span className="eyebrow">SETTINGS</span><h2>设置</h2><p>配置立即保存，对新任务生效；已存在的任务不受影响</p></div>
      </div>
      {!state ? (
        <div className="empty-state"><span>⚙</span><strong>{notice ? notice.text : '正在读取设置…'}</strong></div>
      ) : (
        <>
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
            <h3>Tracker 列表</h3>
            <p>逗号或空白分隔；留空使用内置公共 tracker（优先级：此处 &gt; ARIA2_TRACKERS 环境变量 &gt; 内置列表）</p>
            <textarea className="settings-textarea" rows={4} value={state.trackers} onChange={(event) => setState({ ...state, trackers: event.target.value })} placeholder="udp://tracker.example.org:1337/announce, https://tracker.example.com:443/announce" />
          </div>
          <div className="settings-card">
            <h3>最大同时下载数</h3>
            <p>同时处于下载中的任务数量上限</p>
            <div className="settings-row">
              <input type="number" min={1} max={10} value={state.maxConcurrentDownloads} onChange={(event) => setState({ ...state, maxConcurrentDownloads: Number(event.target.value) })} />
            </div>
          </div>
          <div className="settings-actions">
            <button className="primary-action" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存设置'}<span>→</span></button>
          </div>
          {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
        </>
      )}
    </div>
  )
}
export default Settings
