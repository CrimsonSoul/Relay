import { Component, type ReactNode } from 'react';
import { loggers } from '../../utils/logger';

type KnowledgeSearchBoundaryProps = {
  children: ReactNode;
  fallback: ReactNode;
  onError?: () => void;
};

type KnowledgeSearchBoundaryState = {
  failed: boolean;
};

export class KnowledgeSearchBoundary extends Component<
  KnowledgeSearchBoundaryProps,
  KnowledgeSearchBoundaryState
> {
  state: KnowledgeSearchBoundaryState = { failed: false };

  static getDerivedStateFromError(): KnowledgeSearchBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    const errorClass =
      typeof error === 'object' &&
      error !== null &&
      typeof (error as { constructor?: { name?: unknown } }).constructor?.name === 'string'
        ? (error as { constructor: { name: string } }).constructor.name
        : 'UnknownError';
    loggers.ui.error('Enhanced Wiki search rendering failed', { errorClass });
    this.props.onError?.();
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
