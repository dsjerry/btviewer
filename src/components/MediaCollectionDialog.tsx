// 合集 / 智能合集创建与重命名弹窗：智能模式额外渲染规则编辑（类型 / 观看状态 / 评分 / 添加时间），
// 规则求值在库视图按当前库内容实时进行（src/services/smart-collections.ts 纯函数）。
import React, { useEffect, useState } from 'react'
import { t } from '../services/i18n'
import { hasSmartRule } from '../services/smart-collections'
import type { PersonSummary } from '../services/people'
import type { SmartCollectionRules } from '../types'

interface Props {
  mode: 'create' | 'rename' | 'smart-create' | 'smart-rename'
  name?: string
  rules?: SmartCollectionRules
  error?: string
  people?: PersonSummary[]
  onSave: (value: string, rules?: SmartCollectionRules) => Promise<boolean>
  onClose: () => void
}

const isSmartMode = (mode: Props['mode']) => mode === 'smart-create' || mode === 'smart-rename'

export const MediaCollectionDialog: React.FC<Props> = ({ mode, name = '', rules = {}, error, people = [], onSave, onClose }) => {
  const [value, setValue] = useState(name)
  const [ruleState, setRuleState] = useState<SmartCollectionRules>(rules)
  const [saving, setSaving] = useState(false)
  const smart = isSmartMode(mode)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const setRule = <K extends keyof SmartCollectionRules>(field: K, value: SmartCollectionRules[K]) => setRuleState((current) => ({ ...current, [field]: value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (await onSave(value, smart ? ruleState : undefined)) onClose()
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'smart-create' ? t('library.createSmart') : mode === 'smart-rename' ? t('library.renameSmart') : mode === 'create' ? t('library.createCollection') : t('library.renameCollection')
  return (
    <div className="collection-dialog-overlay" onClick={onClose}>
      <form className="collection-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
        <div className="collection-dialog-head"><strong>{title}</strong><button type="button" className="collection-dialog-close" onClick={onClose} aria-label={t('confirm.cancel')}>×</button></div>
        <label className="collection-name-field">
          <span>{t('library.collectionName')}</span>
          <input autoFocus value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} placeholder={t('library.collectionNamePlaceholder')} />
        </label>
        {smart && (
          <>
            <div className="collection-rule-row">
              <span>{t('library.ruleKind')}</span>
              <select value={ruleState.kind ?? ''} onChange={(event) => setRule('kind', (event.target.value || undefined) as SmartCollectionRules['kind'])}>
                <option value="">{t('library.ruleAny')}</option>
                <option value="video">{t('library.filterVideo')}</option>
                <option value="audio">{t('library.filterAudio')}</option>
              </select>
            </div>
            <div className="collection-rule-row">
              <span>{t('library.ruleWatchState')}</span>
              <select value={ruleState.watchState ?? ''} onChange={(event) => setRule('watchState', (event.target.value || undefined) as SmartCollectionRules['watchState'])}>
                <option value="">{t('library.ruleAny')}</option>
                <option value="unfinished">{t('library.filterUnfinished')}</option>
              </select>
            </div>
            <div className="collection-rule-row">
              <span>{t('library.ruleMinRating')}</span>
              <select value={String(ruleState.minRating ?? '')} onChange={(event) => setRule('minRating', event.target.value ? Number(event.target.value) : undefined)}>
                <option value="">{t('library.ruleAny')}</option>
                <option value="3">≥ 3 ★</option>
                <option value="4">≥ 4 ★</option>
                <option value="5">≥ 5 ★</option>
              </select>
            </div>
            <div className="collection-rule-row">
              <span>{t('library.ruleAddedWithin')}</span>
              <select value={String(ruleState.addedWithinDays ?? '')} onChange={(event) => setRule('addedWithinDays', event.target.value ? Number(event.target.value) : undefined)}>
                <option value="">{t('library.ruleAny')}</option>
                <option value="7">7 {t('library.ruleDays')}</option>
                <option value="30">30 {t('library.ruleDays')}</option>
              </select>
            </div>
            {people.length > 0 && (
              <div className="collection-rule-row">
                <span>{t('library.rulePerson')}</span>
                <select value={ruleState.personId ?? ''} onChange={(event) => setRule('personId', event.target.value || undefined)}>
                  <option value="">{t('library.ruleAny')}</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name || t('people.unnamed')}</option>)}
                </select>
              </div>
            )}
            <p className="collection-rule-hint">{t('library.smartHint')}</p>
          </>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="small-button" onClick={onClose}>{t('confirm.cancel')}</button>
          <button type="submit" className="small-button primary" disabled={saving || !value.trim() || (smart && !hasSmartRule(ruleState))}>{t('library.saveCollection')}</button>
        </div>
      </form>
    </div>
  )
}
