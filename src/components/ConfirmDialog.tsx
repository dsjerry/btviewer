// 通用确认弹窗：原生 window.confirm 无法携带选项（如「是否连本地文件一起删」），故做这个最小弹窗。
// 可选勾选框；Enter 触发聚焦按钮、Esc 取消。删除类场景传 danger 使确认键呈红色。
import React, { useEffect, useRef, useState } from 'react'
import { t } from '../services/i18n'

interface Props {
  open: boolean
  message: React.ReactNode
  checkboxLabel?: string
  confirmText?: string
  onConfirm: (checked: boolean) => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<Props> = ({ open, message, checkboxLabel, confirmText, onConfirm, onCancel }) => {
  const [checked, setChecked] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) { setChecked(false); confirmRef.current?.focus() } }, [open])
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])
  if (!open) return null
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-dialog" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{message}</p>
        {checkboxLabel && <label className="confirm-checkbox"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />{checkboxLabel}</label>}
        <div className="confirm-actions">
          <button className="small-button" onClick={onCancel}>{t('confirm.cancel')}</button>
          <button className="small-button danger" ref={confirmRef} onClick={() => onConfirm(checked)}>{confirmText || t('confirm.confirmRemove')}</button>
        </div>
      </div>
    </div>
  )
}
