import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Root error boundary. A render crash otherwise unmounts the whole React
 * tree and leaves a black page with no explanation — this keeps the app
 * frame and surfaces the actual error so it can be reported or recovered
 * from without losing the session.
 */
interface ErrorBoundaryState {
  error: Error | null
  componentStack: string | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, componentStack: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[kovr] UI error:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
        <p className="font-mono text-2xl font-bold tracking-tight text-on-surface">KOVR</p>
        <p className="text-sm font-medium text-on-surface">Something went wrong</p>
        <pre className="max-w-xl overflow-auto rounded-lg border border-error/30 bg-error/5 p-3 text-left font-mono text-[11px] leading-relaxed text-on-error-container">
          {this.state.error.message}
        </pre>
        {this.state.componentStack && (
          <details className="max-w-xl text-left">
            <summary className="cursor-pointer text-xs text-on-surface-variant">
              Where it happened (component stack)
            </summary>
            <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-outline-variant bg-surface-container-lowest p-3 font-mono text-[10px] leading-relaxed text-on-surface-variant">
              {this.state.componentStack}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => this.setState({ error: null, componentStack: null })}
            className="rounded-lg border border-outline-variant px-4 py-2 text-sm text-on-surface-variant transition-colors hover:border-outline hover:text-on-surface"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20"
          >
            Reload the app
          </button>
        </div>
      </div>
    )
  }
}
