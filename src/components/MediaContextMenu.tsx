// 媒体库右键菜单：定位（贴边收进视口）、关闭（点击外部 / Esc / 滚动 / 改变窗口大小）与渲染，
// 动作闭包由 FileList 在打开时注入（play/openDetail/onAdd/onRemoveFromCollection/onRemove）。
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { t } from '../services/i18n'
import type { MediaCollection } from '../types'

export interface MediaMenuData {
  x: number
  y: number
  title: string
  play: (() => void) | null
  openDetail: (() => void) | null
  collections: MediaCollection[]
  inCollection: boolean
  onAdd: (collectionId: string) => void
  onRemoveFromCollection: () => void
  onRemove: () => void
}

interface Props {
  menu: MediaMenuData | null
  onClose: () => void
}

const run = (close: () => void, action: () => void) => () => { close(); action() }

export const MediaContextMenu: React.FC<Props> = ({ menu, onClose }) => {
  const ref = useRef<HTMLDivElement>(null)
  // 先按光标坐标渲染，再用实测尺寸收进视口（layout 阶段完成，不闪跳）
  const [shift, setShift] = useState({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!menu) return
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setShift({
      x: Math.min(0, window.innerWidth - rect.width - 8 - menu.x),
      y: Math.min(0, window.innerHeight - rect.height - 8 - menu.y)
    })
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const inside = (target: EventTarget | null) => ref.current !== null && target instanceof Node && ref.current.contains(target)
    const onMouseDown = (event: MouseEvent) => { if (!inside(event.target)) onClose() }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onScroll = (event: Event) => { if (!inside(event.target)) onClose() }
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [menu, onClose])
  if (!menu) return null
  return (
    <div ref={ref} className="media-context-menu" role="menu" style={{ left: menu.x + shift.x, top: menu.y + shift.y }}>
      <div className="media-context-title" title={menu.title}>{menu.title}</div>
      {menu.play && <button type="button" role="menuitem" onClick={run(onClose, menu.play)}>▶ {t('library.play')}</button>}
      {menu.openDetail && <button type="button" role="menuitem" onClick={run(onClose, menu.openDetail)}>▤ {t('library.openDetail')}</button>}
      {(menu.play || menu.openDetail) && <div className="media-context-divider" />}
      <div className="media-context-label">{t('library.addToCollection')}</div>
      <div className="media-context-collections">
        {menu.collections.map((collection) => (
          <button key={collection.id} type="button" role="menuitem" title={collection.name} onClick={run(onClose, () => menu.onAdd(collection.id))}>{collection.name}</button>
        ))}
        {!menu.collections.length && <span className="media-context-empty">{t('library.noCollectionsHint')}</span>}
      </div>
      {menu.inCollection && <button type="button" role="menuitem" onClick={run(onClose, menu.onRemoveFromCollection)}>{t('library.removeFromCollection')}</button>}
      <div className="media-context-divider" />
      <button type="button" role="menuitem" className="danger" onClick={run(onClose, menu.onRemove)}>{t('library.removeRecord')}</button>
    </div>
  )
}
