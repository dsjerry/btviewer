import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// macOS 用 hiddenInset 原生红绿灯按钮，侧栏标题需让出左上角；其它平台由 CSS 保持原样
document.documentElement.dataset.platform = navigator.userAgent.includes('Macintosh') ? 'darwin' : 'other'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
