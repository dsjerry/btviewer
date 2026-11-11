import React, { useEffect, useState } from 'react'
import { t } from '../services/i18n'

interface Props {
  mode: 'create' | 'rename'
  name?: string
  error?: string
  onSave: (value: string) => Promise<boolean>
  onClose: () => void
}

export const MediaCollectionDialog: React.FC<Props> = ({ mode, name = '', error, onSave, onClose }) => {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      if (await onSave(value)) onClose()
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'create' ? t('library.createCollection') : t('library.renameCollection')
  return (
    <div className="collection-dialog-overlay" onClick={onClose}>
      <form className="collection-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} onSubmit={(event) => void submit(event)}>
        <div className="collection-dialog-head"><strong>{title}</strong><button type="button" className="collection-dialog-close" onClick={onClose} aria-label={t('confirm.cancel')}>×</button></div>
        <label className="collection-name-field">
          <span>{t('library.collectionName')}</span>
          <input autoFocus value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} placeholder={t('library.collectionNamePlaceholder')} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="confirm-actions">
          <button type="button" className="small-button" onClick={onClose}>{t('confirm.cancel')}</button>
          <button type="submit" className="small-button primary" disabled={saving || !value.trim()}>{t('library.saveCollection')}</button>
        </div>
      </form>
    </div>
  )
}
