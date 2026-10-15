import React, { useEffect, useState } from 'react'
import { ipc } from '../services/ipc'
import { t } from '../services/i18n'
import type { Feed } from '../types'

// RSS 订阅页：添加/管理订阅源，查看最近抓取条目，手动补下未自动下载的条目
const Feeds: React.FC = () => {
  const [feeds, setFeeds] = useState<Feed[] | null>(null)
  const [notice, setNotice] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', url: '', keywords: '', autoDownload: true, groupBySeason: false })

  useEffect(() => { void (async () => { const result = await ipc.feedsGet(); if (result.success && result.data) setFeeds(result.data); else setNotice({ type: 'error', text: result.error || t('feeds.loadFailed') }) })() }, [])

  const replaceFeed = (feed: Feed) => setFeeds((list) => list ? list.map((item) => item.id === feed.id ? feed : item) : list)

  const check = async (id: string) => {
    setCheckingId(id); setNotice(null)
    try {
      const result = await ipc.feedsCheck(id)
      if (result.success && result.data) { const feed = result.data.find((item) => item.id === id); if (feed) replaceFeed(feed) }
      else setNotice({ type: 'error', text: result.error || t('feeds.refreshFailed') })
    } finally { setCheckingId(null) }
  }

  const add = async () => {
    if (!form.url.trim()) { setNotice({ type: 'error', text: t('feeds.urlRequired') }); return }
    setNotice(null)
    const result = await ipc.feedsAdd({
      name: form.name, url: form.url,
      keywords: form.keywords.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean),
      autoDownload: form.autoDownload, groupBySeason: form.groupBySeason
    })
    if (!result.success || !result.data) { setNotice({ type: 'error', text: result.error || t('feeds.addFailed') }); return }
    setForm({ name: '', url: '', keywords: '', autoDownload: true, groupBySeason: false })
    await ipc.feedsGet().then((r) => { if (r.success && r.data) setFeeds(r.data) })
    void check(result.data.id)
  }

  const toggle = async (feed: Feed, patch: Partial<Pick<Feed, 'enabled' | 'autoDownload' | 'groupBySeason'>>) => {
    const result = await ipc.feedsUpdate(feed.id, patch)
    if (result.success && result.data) replaceFeed(result.data)
    else setNotice({ type: 'error', text: result.error || t('feeds.saveFailed') })
  }

  const remove = (feed: Feed) => {
    if (!window.confirm(`删除订阅「${feed.name}」？已下载的任务不受影响。`)) return
    void (async () => {
      const result = await ipc.feedsRemove(feed.id)
      if (result.success) setFeeds((list) => list ? list.filter((item) => item.id !== feed.id) : list)
      else setNotice({ type: 'error', text: result.error || t('feeds.deleteFailed') })
    })()
  }

  const downloadItem = async (feed: Feed, guid: string) => {
    setNotice(null)
    const result = await ipc.feedsDownloadItem(feed.id, guid)
    if (result.success) replaceFeed({ ...feed, items: feed.items.map((item) => item.guid === guid ? { ...item, downloaded: true } : item) })
    else setNotice({ type: 'error', text: result.error || t('feeds.downloadFailed') })
  }

  const checkedAt = (feed: Feed) => {
    if (!feed.lastCheckedAt) return t('feeds.neverChecked')
    const minutes = Math.floor((Date.now() - feed.lastCheckedAt) / 60000)
    if (minutes < 1) return t('feeds.justChecked')
    if (minutes < 60) return `${minutes} 分钟前抓取`
    return `${Math.floor(minutes / 60)} 小时前抓取`
  }

  return <div className="page-content">
    <div className="page-heading"><div><span className="eyebrow">{t('feeds.manageEyebrow')}</span><h2>{t('feeds.title')}</h2><p>{t('feeds.subtitle')}</p></div><span className="heading-count">{(feeds?.length ?? 0).toString().padStart(2, '0')}</span></div>
    <div className="settings-card">
      <h3>{t('feeds.addTitle')}</h3>
      <p>{t('feeds.addHint')}</p>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="RSS 订阅地址，例如 https://example.com/feed.xml" /></div>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="订阅名称（作为归类目录名，可留空）" /></div>
      <div className="settings-row" style={{ marginBottom: 8 }}><input type="text" value={form.keywords} onChange={(event) => setForm({ ...form, keywords: event.target.value })} placeholder="过滤关键词，逗号分隔，例如 1080p, 简体" /></div>
      <div className="feed-form-options">
        <label className="settings-check"><input type="checkbox" checked={form.autoDownload} onChange={(event) => setForm({ ...form, autoDownload: event.target.checked })} />{t('feeds.autoDownload')}</label>
        <label className="settings-check"><input type="checkbox" checked={form.groupBySeason} onChange={(event) => setForm({ ...form, groupBySeason: event.target.checked })} />{t('feeds.groupBySeason')}</label>
        <button className="primary-action" style={{ width: 'auto', flex: 'none', padding: '9px 20px', margin: 0 }} onClick={() => void add()}>{t('feeds.addAndFetch')}</button>
      </div>
    </div>
    {!feeds ? <div className="empty-state"><span>⇄</span><strong>{t('feeds.loading')}</strong></div> : !feeds.length ? <div className="empty-state"><span>⇄</span><strong>{t('feeds.empty')}</strong><p>{t('feeds.emptyHint')}</p></div> : <div className="download-stack">{feeds.map((feed) => <article className="feed-card" key={feed.id}>
      <div className="feed-head">
        <div className="feed-title"><strong>{feed.name}</strong>{!feed.enabled && <span className="feed-badge off">{t('feeds.disabled')}</span>}{feed.autoDownload && <span className="feed-badge">{t('feeds.autoBadge')}</span>}{feed.groupBySeason && <span className="feed-badge">{t('feeds.seasonBadge')}</span>}</div>
        <button className="small-button" disabled={checkingId === feed.id} onClick={() => void check(feed.id)}>{checkingId === feed.id ? t('feeds.fetching') : t('feeds.refreshNow')}</button>
      </div>
      <div className="feed-url" title={feed.url}>{feed.url}</div>
      <div className="feed-meta">
        <span>{checkedAt(feed)}</span>
        {feed.keywords.length > 0 && <span>关键词：{feed.keywords.join('、')}</span>}
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.enabled} onChange={(event) => void toggle(feed, { enabled: event.target.checked })} />{t('feeds.enable')}</label>
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.autoDownload} onChange={(event) => void toggle(feed, { autoDownload: event.target.checked })} />{t('feeds.autoShort')}</label>
        <label className="settings-check feed-inline-check"><input type="checkbox" checked={feed.groupBySeason} onChange={(event) => void toggle(feed, { groupBySeason: event.target.checked })} />{t('feeds.seasonShort')}</label>
        <button className="small-button danger feed-remove" onClick={() => remove(feed)}>{t('feeds.delete')}</button>
      </div>
      {feed.lastError && <p className="task-error">{feed.lastError}</p>}
      {feed.items.length > 0 && <div className="feed-items">
        {feed.items.slice(0, 10).map((item) => <div className="feed-item" key={item.guid}>
          <span title={item.title}>{item.title}</span>
          {item.downloaded && <span className="feed-badge">{t('feeds.downloaded')}</span>}
          {!item.downloaded && (item.magnet || item.torrentUrl) && <button className="small-button" onClick={() => void downloadItem(feed, item.guid)}>{t('feeds.download')}</button>}
        </div>)}
      </div>}
    </article>)}</div>}
    {notice && <div className={`inline-notice ${notice.type}`}>{notice.type === 'error' ? '!' : '✓'} {notice.text}</div>}
  </div>
}
export default Feeds
