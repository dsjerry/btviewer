import React from 'react'

const iconUrl = new URL('../../resources/icon.png', import.meta.url).href

const AppIcon: React.FC<{ className?: string; decorative?: boolean }> = ({ className, decorative = false }) => (
  <img className={className} src={iconUrl} alt={decorative ? '' : 'BTViewer'} aria-hidden={decorative || undefined} draggable={false} />
)

export default AppIcon
