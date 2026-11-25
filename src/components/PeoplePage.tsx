// 人物页（左侧导航入口）：卡片网格支持搜索、排序、多选批量合并与删除；详情页按人脸缩略图多选后拆分为新人物。
// 人物列表从主进程拉取，分析入库的广播经防抖合并后再刷新；分析状态来自渲染层的后台分析循环。
import React, { useEffect, useMemo, useState } from 'react'
import { ipc } from '../services/ipc'
import { t } from '../services/i18n'
import { trailingDebounce } from '../services/debounce'
import { subscribePeopleAnalysis, type PeopleAnalysisStatus } from '../services/people-runtime'
import { ConfirmDialog } from './ConfirmDialog'
import { arrangePersons, fileNameOf, PERSON_SORTS, type FaceView, type PersonSort, type PersonSummary } from '../services/people'

interface Props {
  onOpenPerson: (personId: string) => void
  onOpenSettings: () => void
}

const SAVED_HINT_MS = 1500
const REFRESH_DEBOUNCE_MS = 800

export const PeoplePage: React.FC<Props> = ({ onOpenPerson, onOpenSettings }) => {
  const [people, setPeople] = useState<PersonSummary[]>([])
  const [analysed, setAnalysed] = useState(0)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [analysis, setAnalysis] = useState<PeopleAnalysisStatus>({ state: 'idle', current: null })
  const [savedId, setSavedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PersonSort>('faces')
  const [selectedPeople, setSelectedPeople] = useState<Set<string>>(new Set())
  const [mergeTarget, setMergeTarget] = useState('')
  const [removeIds, setRemoveIds] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | null>(null)
  const [faces, setFaces] = useState<FaceView[]>([])
  const [selectedFaces, setSelectedFaces] = useState<Set<string>>(new Set())
  const detail = people.find((person) => person.id === detailId) ?? null
  const arranged = useMemo(() => arrangePersons(people, query, sort), [people, query, sort])

  useEffect(() => {
    let active = true
    const load = () => {
      void ipc.peopleSummary().then((summary) => {
        if (!active || !summary.success || !summary.data) return
        setPeople(summary.data.people)
        setAnalysed(summary.data.analyzed)
      }).catch(() => undefined)
    }
    const debounced = trailingDebounce(load, REFRESH_DEBOUNCE_MS)
    load()
    void ipc.getSettings().then((settings) => {
      if (active && settings.success) setEnabled(settings.data?.peopleEnabled === true)
    }).catch(() => undefined)
    let unsubscribe: () => void = () => undefined
    try { unsubscribe = ipc.onPeopleChanged(debounced.call) } catch { /* 非 Electron 环境忽略 */ }
    const unsubscribeAnalysis = subscribePeopleAnalysis((next) => { if (active) setAnalysis(next) })
    return () => { active = false; debounced.cancel(); unsubscribe(); unsubscribeAnalysis() }
  }, [])

  // 人物被合并或删除后，去掉已不存在的选中项
  useEffect(() => {
    setSelectedPeople((current) => new Set([...current].filter((id) => people.some((person) => person.id === id))))
  }, [people])

  useEffect(() => {
    if (!detailId) return
    let active = true
    void ipc.peopleFaces(detailId).then((result) => {
      if (!active || !result.success || !result.data) return
      setFaces(result.data)
      setSelectedFaces(new Set())
    }).catch(() => undefined)
    return () => { active = false }
  }, [detailId, people])

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  const splitSelected = async () => {
    if (selectedFaces.size === 0) return
    await ipc.peopleSplit([...selectedFaces]).catch(() => null)
  }

  const mergeSelected = async () => {
    const sources = [...selectedPeople].filter((id) => id !== mergeTarget)
    if (!mergeTarget || sources.length === 0) return
    await ipc.peopleMerge(sources, mergeTarget).catch(() => null)
    setSelectedPeople(new Set())
    setMergeTarget('')
  }

  const removePeople = async () => {
    if (removeIds.length) await ipc.peopleRemove(removeIds).catch(() => null)
    setSelectedPeople((current) => new Set([...current].filter((id) => !removeIds.includes(id))))
    setRemoveIds([])
  }

  const renamePerson = (person: PersonSummary, value: string) => {
    const name = value.trim()
    if (name === person.name) return
    void ipc.peopleRename(person.id, name).then((result) => {
      if (!result.success) return
      setSavedId(person.id)
      window.setTimeout(() => setSavedId((current) => (current === person.id ? null : current)), SAVED_HINT_MS)
    }).catch(() => null)
  }

  const statusText = analysis.state === 'idle' ? t('people.statusIdle')
    : analysis.state === 'paused' ? t('people.statusPaused')
      : analysis.current ? t('people.statusRunning', { name: fileNameOf(analysis.current) }) : t('people.statusWaiting')
  const canMerge = !!mergeTarget && [...selectedPeople].some((id) => id !== mergeTarget)
  const confirmMessage = removeIds.length > 1 ? t('people.deleteManyConfirm', { count: removeIds.length }) : t('people.deleteConfirm')

  if (detail) {
    return (
      <div className="people-page">
        <header className="people-page-head">
          <button className="back-link" onClick={() => setDetailId(null)}>{t('people.back')}</button>
          <div><h2>{detail.name || t('people.unnamed')}</h2><p>{t('people.splitHint')}</p></div>
        </header>
        {detail.faces > faces.length && <p className="people-hint">{t('people.faceLimit', { shown: faces.length, total: detail.faces })}</p>}
        <div className="people-actions people-face-actions">
          <button className="small-button" onClick={() => setSelectedFaces(new Set(faces.map((face) => face.id)))} disabled={!faces.length}>{t('people.selectAllFaces')}</button>
          <button className="small-button" onClick={() => setSelectedFaces(new Set())} disabled={!selectedFaces.size}>{t('people.clearFaces')}</button>
          <button className="small-button primary" disabled={selectedFaces.size === 0} onClick={() => void splitSelected()}>{t('people.splitSelected', { count: selectedFaces.size })}</button>
        </div>
        <div className="people-face-grid">
          {faces.map((face) => (
            <label key={face.id} className={`people-face ${selectedFaces.has(face.id) ? 'is-selected' : ''}`} title={`${face.videoKey} · ${Math.round(face.t)}s`}>
              <input type="checkbox" checked={selectedFaces.has(face.id)} onChange={() => setSelectedFaces((current) => toggle(current, face.id))} aria-label={t('people.selectFace')} />
              <img src={face.thumb} alt="" />
              <span className="people-face-video">{fileNameOf(face.videoKey)}</span>
            </label>
          ))}
        </div>
        {!faces.length && <p className="people-hint">{t('people.noFaces')}</p>}
      </div>
    )
  }

  return (
    <div className="people-page">
      <header className="people-page-head">
        <div><h2>{t('people.pageTitle')}</h2><p>{t('people.pageHint')}</p></div>
        {enabled && (
          <div className="people-status">
            <span className={`people-status-dot is-${analysis.state}`} aria-hidden="true" />
            <span role="status" aria-live="polite">{statusText}</span>
            <small>{t('people.analysed', { count: analysed })}</small>
          </div>
        )}
      </header>
      {enabled === false && (
        <div className="people-empty">
          <p>{t('people.disabledHint')}</p>
          <button className="small-button primary" onClick={onOpenSettings}>{t('people.goSettings')}</button>
        </div>
      )}
      {enabled && !people.length && <div className="people-empty"><p>{t('people.emptyHint')}</p></div>}
      {people.length > 0 && (
        <div className="people-toolbar">
          <input type="search" className="people-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('people.searchPlaceholder')} aria-label={t('people.searchPlaceholder')} />
          <select aria-label={t('people.sortLabel')} value={sort} onChange={(event) => setSort(event.target.value as PersonSort)}>
            {PERSON_SORTS.map((key) => <option key={key} value={key}>{t(`people.sort.${key}`)}</option>)}
          </select>
        </div>
      )}
      {selectedPeople.size > 0 && (
        <div className="people-bulk" role="toolbar" aria-label={t('people.selectedCount', { count: selectedPeople.size })}>
          <span className="people-bulk-count">{t('people.selectedCount', { count: selectedPeople.size })}</span>
          <select aria-label={t('people.mergeTo')} value={mergeTarget} onChange={(event) => setMergeTarget(event.target.value)}>
            <option value="">{t('people.mergeTo')}</option>
            {people.map((person) => <option key={person.id} value={person.id}>{person.name || t('people.unnamed')}</option>)}
          </select>
          <button className="small-button" disabled={!canMerge} onClick={() => void mergeSelected()}>{t('people.merge')}</button>
          <button className="small-button danger" onClick={() => setRemoveIds([...selectedPeople])}>{t('people.delete')}</button>
          <button className="small-button" onClick={() => setSelectedPeople(new Set())}>{t('people.clearSelection')}</button>
        </div>
      )}
      {people.length > 0 && !arranged.length && <p className="people-hint">{t('people.noMatch')}</p>}
      <div className="people-grid">
        {arranged.map((person) => {
          const checked = selectedPeople.has(person.id)
          const more = person.videos - person.topVideos.length
          return (
            <article key={person.id} className={`people-card ${checked ? 'is-selected' : ''}`}>
              <button className="people-delete" title={t('people.delete')} aria-label={t('people.delete')} onClick={() => setRemoveIds([person.id])}>×</button>
              <label className="people-check" title={t('people.selectPerson')}>
                <input type="checkbox" checked={checked} onChange={() => setSelectedPeople((current) => toggle(current, person.id))} aria-label={t('people.selectPerson')} />
              </label>
              <div className="people-card-head">
                {person.thumbs[0] ? <img className="people-thumb" src={person.thumbs[0]} alt="" /> : <span className="people-thumb" />}
                <div className="people-info">
                  <input
                    defaultValue={person.name}
                    placeholder={t('people.unnamed')}
                    maxLength={40}
                    aria-label={t('people.unnamed')}
                    onBlur={(event) => renamePerson(person, event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                  <small>{t('people.stats', { faces: person.faces, videos: person.videos })}{savedId === person.id && <em className="people-saved">{t('people.saved')}</em>}</small>
                </div>
              </div>
              {person.thumbs.length > 1 && (
                <div className="people-strip">
                  {person.thumbs.slice(1).map((src, index) => <img key={index} src={src} alt="" />)}
                </div>
              )}
              {person.topVideos.length > 0 && (
                <p className="people-videos" title={person.topVideos.join('\n')}>
                  {person.topVideos.join(' · ')}{more > 0 && <span className="people-videos-more"> {t('people.moreVideos', { count: more })}</span>}
                </p>
              )}
              <div className="people-actions">
                <button className="small-button primary" onClick={() => onOpenPerson(person.id)}>{t('people.open')}</button>
                <button className="small-button" onClick={() => setDetailId(person.id)}>{t('people.split')}</button>
              </div>
            </article>
          )
        })}
      </div>
      <ConfirmDialog open={removeIds.length > 0} message={confirmMessage} onConfirm={() => void removePeople()} onCancel={() => setRemoveIds([])} />
    </div>
  )
}
