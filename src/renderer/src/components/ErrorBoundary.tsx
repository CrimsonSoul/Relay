import React, { Component, ErrorInfo, ReactNode } from 'react';
import { TactileButton } from './TactileButton';
import { loggers } from '../utils/logger';
import { ErrorCategory } from '@shared/logging';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
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

  // eslint-disable-next-line sonarjs/function-return-type
  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="error-page">
          <div className="error-page-icon">⚠</div>
          <h1 className="error-page-title">Something went wrong</h1>
          <p className="error-page-message">
            The application encountered an unexpected error. Please restart the application.
          </p>
          <pre className="error-page-stack">{this.state.error?.message || 'Unknown error'}</pre>
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
