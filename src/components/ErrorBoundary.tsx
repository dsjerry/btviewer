import React from 'react'

// 渲染层兜底：子树抛异常时展示可恢复的错误页，避免整个应用白屏
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) { return { error } }

  componentDidCatch(error: Error) {
    console.error('[Renderer] 未捕获的渲染异常:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="error-boundary">
        <span>⚠</span>
        <strong>页面出现异常</strong>
        <p>{this.state.error.message || String(this.state.error)}</p>
        <div className="error-boundary-actions">
          <button className="small-button" onClick={() => this.setState({ error: null })}>重试</button>
          <button className="small-button" onClick={() => window.location.reload()}>重新加载</button>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
