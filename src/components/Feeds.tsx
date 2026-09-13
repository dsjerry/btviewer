import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import type { Feed } from '../types'

// RSS 订阅页：添加/管理订阅源，查看最近抓取条目，手动补下未自动下载的条目
const Feeds: React.FC = () => {
  const [feeds, setFeeds] = useState<Feed[] | null>(null)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', url: '', keywords: '', autoDownload: true, groupBySeason: false })

  useEffect(() => { void (async () => { const result = await ipc.feedsGet(); if (result.success && result.data) setFeeds(result.data); else setNotice({ type: 'error', text: result.error || '读取订阅失败' }) })() }, [])

  const replaceFeed = (feed: Feed) => setFeeds((list) => list ? list.map((item) => item.id === feed.id ? feed : item) : list)

  const check = async (id: string) => {
    setCheckingId(id); setNotice(null)
    try {
      const result = await ipc.feedsCheck(id)
      if (result.success && result.data) { const feed = result.data.find((item) => item.id === id); if (feed) replaceFeed(feed) }
      else setNotice({ type: 'error', text: result.error || '刷新失败' })
    } finally { setCheckingId(null) }
  }

  const add = async () => {
    if (!form.url.trim()) { setNotice({ type: 'error', text: '请填写 RSS 订阅地址' }); return }
    setNotice(null)
    const result = await ipc.feedsAdd({
      name: form.name, url: form.url,
      keywords: form.keywords.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
      autoDownload: form.autoDownload, groupBySeason: form.groupBySeason
    })
    if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || '添加订阅失败' }); return }
    setForm({ name: '', url: '', keywords: '', autoDownload: true, groupBySeason: false })
    await ipc.feedsGet().then((r) => { if (r.success && r.data) setFeeds(r.data) })
    void check(result.data.id)
  }

  const toggle = async (feed: Feed, patch: Partial<Pick<Feed, 'enabled' | 'autoDownload' | 'groupBySeason'>>) => {
    const result = await ipc.feedsUpdate(feed.id, patch)
    if (result.success && result.data) replaceFeed(result.data)
    else setNotice({ type: 'error', text: result.error || '保存失败' })
  }

  const remove = (feed: Feed) => {
    if (!window.confirm(`删除订阅「${feed.name}」？已下载的任务不受影响。`)) return
    void (async () => {
      const result = await ipc.feedsRemove(feed.id)
      if (result.success) setFeeds((list) => list ? list.filter((item) => item.id !== feed.id) : list)
      else setNotice({ type: 'error', text: result.error || '删除失败' })
    })()
  }

  const downloadItem = async (feed: Feed, guid: string) => {
    setNotice(null)
    const result = await ipc.feedsDownloadItem(feed.id, guid)
    if (result.success) replaceFeed({ ...feed, items: feed.items.map((item) => item.guid === guid ? { ...item, downloaded: true } : item) })
    else setNotice({ type: 'error', text: result.error || '下载失败' })
  }

  const checkedAt = (feed: Feed) => {
    if (!feed.lastCheckedAt) return '尚未抓取'
    const minutes = Math.floor((Date.now() - feed.lastCheckedAt) / 60000)
    if (minutes < 1) return '刚刚抓取'
    if (minutes < 60) return `${minutes} 分钟前抓取`
    return `${Math.floor(minutes / 60)} 小时前抓取`
  }

  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">订阅管理</span><h2>订阅</h2><p>轮询 RSS 源，命中关键词的新条目自动加入下载；按季归类存放于 下载目录/订阅名/Sxx</p></div><span className="heading-count">{(feeds?.length ?? 0).toString().padStart(2, '0')}</span></div>
    <div className="settings-card">
      <h3>添加订阅</h3>
      <p>关键词为空时下载全部条目；多个关键词需全部命中</p>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="RSS 订阅地址，例如 https://example.com/feed.xml" /></div>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="订阅名称（作为归类目录名，可留空）" /></div>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="过滤关键词，逗号分隔，例如 1080p, 简体" /></div>
      <div className="feed-form-options">
        <label className="settings-check"><input type="checkbox" checked={form.autoDownload} onChange={(event) => setForm({ ...form, autoDownload: event.target.checked })} />自动下载新条目</label>
        <label className="settings-check"><input type="checkbox" checked={form.groupBySeason} onChange={(event) => setForm({ ...form, groupBySeason: event.target.checked })} />按季归类子目录</label>
        <button className="primary-action" style={{ width: 'auto', flex: 'none', padding: '9px 20px', margin: 0 }} onClick={() => void add()}>添加并抓取</button>
      </div>
    </div>
    {!feeds ? <div className="empty-state"><span>⇄</span><strong>正在读取订阅…</strong></div> : !feeds.length ? <div className="empty-state"><span>⇄</span><strong>还没有订阅</strong><p>添加一个 RSS 源，新资源会自动进入下载任务。</p></div> : <div className="download-stack">{feeds.map((feed) => <article className="feed-card" key={feed.id}>
      <div className="feed-head">
        <div className="feed-title"><strong>{feed.name}</strong>{!feed.enabled && <span className="feed-badge off">已停用</span>}{feed.autoDownload && <span className="feed-badge">自动下载</span>}{feed.groupBySeason && <span className="feed-badge">按季归类</span>}</div>
        <button className="small-button" disabled={checkingId === feed.id} onClick={() => void check(feed.id)}>{checkingId === feed.id ? '抓取中…' : '立即刷新'}</button>
      </div>
      <div className="feed-url" title={feed.url}>{feed.url}</div>
      <div className="feed-meta">
        <span>{checkedAt(feed)}</span>
        {feed.keywords.length > 0 && <span>关键词：{feed.keywords.join('、')}</span>}
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.enabled} onChange={(event) => void toggle(feed, { enabled: event.target.checked })} />启用</label>
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.autoDownload} onChange={(event) => void toggle(feed, { autoDownload: event.target.checked })} />自动下载</label>
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.groupBySeason} onChange={(event) => void toggle(feed, { groupBySeason: event.target.checked })} />按季归类</label>
        <button className="small-button danger feed-remove" onClick={() => remove(feed)}>删除</button>
      </div>
      {feed.lastError && <p className="task-error">{feed.lastError}</p>}
      {feed.items.length > 0 && <div className="feed-items">
        {feed.items.slice(0, 10).map((item) => <div className="feed-item" key={item.guid}>
          <span title={item.title}>{item.title}</span>
          {item.downloaded && <span className="feed-badge">已下载</span>}
          {!item.downloaded && (item.magnet || item.torrentUrl) && <button className="small-button" onClick={() => void downloadItem(feed, item.guid)}>下载</button>}
        </div>)}
      </div>}
    </article>)}</div>}
    {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
  </div>
}
export default Feeds
