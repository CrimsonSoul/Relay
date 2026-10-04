import React, { Component, ErrorInfo, ReactNode } from 'react';
import { TactileButton } from './TactileButton';
import { loggers } from '../utils/logger';
import { ErrorCategory } from '@shared/logging';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((resetErrorBoundary: () => void) => ReactNode);
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private readonly headingRef = React.createRef<HTMLHeadingElement>();

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** Move focus onto the default fallback's heading so keyboard users land on the failure. A
      child that throws on first render shows the fallback at mount; later throws, at update. */
  componentDidMount() {
    if (this.state.hasError) this.headingRef.current?.focus();
  }

  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState) {
    if (this.state.hasError && !prevState.hasError) this.headingRef.current?.focus();
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    loggers.ui.error('React component error caught by ErrorBoundary', {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      category: ErrorCategory.COMPONENT,
    });
  }

  resetErrorBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  // eslint-disable-next-line sonarjs/function-return-type
  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.resetErrorBoundary)
          : this.props.fallback;
      }
      return (
        <div className="error-page" role="alert">
          <div className="error-page-icon" aria-hidden="true">
            ⚠
          </div>
          <h1 className="error-page-title" ref={this.headingRef} tabIndex={-1}>
            Something went wrong
          </h1>
          <p className="error-page-message">
            The application encountered an unexpected error. Try again, or reload the application if
            it happens again.
          </p>
          <pre className="error-page-stack">{this.state.error?.message || 'Unknown error'}</pre>
          <TactileButton
            onClick={this.resetErrorBoundary}
            variant="secondary"
            className="error-page-reload-btn"
          >
            Try Again
          </TactileButton>
          <TactileButton
            onClick={() => globalThis.location.reload()}
            variant="primary"
            className="error-page-reload-btn"
          >
            Reload Application
          </TactileButton>
        </div>
      );
    }

    return this.props.children;
  }
}
