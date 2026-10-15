// Catches a crash in the interface so it can't take the page down: the canvas and the controller sit
// outside this boundary, so the visuals keep running while the message is up.

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Interface error', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>The controls hit a problem</h2>
        <p>The visuals keep running. Try again, or reload the app.</p>
        <pre>{error.message}</pre>
        <div className="crash-actions">
          <button onClick={() => this.setState({ error: null })}>Try again</button>
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
