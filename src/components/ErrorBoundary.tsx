import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * One broken panel must not black out the workshop screen. Each major region is wrapped
 * so a render failure — usually an unexpected payload shape — degrades to a message plus
 * a retry, while the rest of the fleet stays visible.
 */
export class ErrorBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[dashboard] lỗi hiển thị ở "${this.props.label}"`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="banner banner-critical" role="alert">
        <strong>Không hiển thị được “{this.props.label}”.</strong>
        <span>{this.state.error.message}</span>
        <button type="button" onClick={() => this.setState({ error: null })}>Thử lại</button>
      </div>
    )
  }
}
