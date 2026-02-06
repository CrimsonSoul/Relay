import React from 'react';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import { vi } from 'vitest';

describe('ErrorBoundary Component', () => {
  beforeEach(() => {
    // Mock window.location.reload using Object.defineProperty
    vi.stubGlobal('location', {
      reload: vi.fn(),
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders children when there is no error', () => {
    const ChildComponent = () => <div>Normal Component</div>;

    render(
      <ErrorBoundary>
        <ChildComponent />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Normal Component')).toBeInTheDocument();
  });

  it('catches errors and displays error message', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('displays reload button when error occurs', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const reloadButton = screen.getByText('Reload Application');
    expect(reloadButton).toBeInTheDocument();
  });

  it('reloads page when reload button is clicked', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    const reloadButton = screen.getByText('Reload Application');
    reloadButton.click();

    expect(window.location.reload).toHaveBeenCalled();
  });

  it('logs error to console', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    const consoleSpy = vi.spyOn(console, 'error');

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(consoleSpy).toHaveBeenCalled();
  });

  it('handles errors with custom message', () => {
    const ThrowError = () => {
      throw new Error('Custom error message for testing');
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error message for testing')).toBeInTheDocument();
  });

  it('displays unknown error when error message is missing', () => {
    class CustomError extends Error {
      constructor() {
        super('');
        this.name = 'CustomError';
      }
    }

    const ThrowError = () => {
      throw new CustomError();
    };

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Unknown error')).toBeInTheDocument();
  });

  it('handles multiple children', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    const NormalChild = () => <div>Normal Component</div>;

    render(
      <ErrorBoundary>
        <NormalChild />
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.queryByText('Normal Component')).not.toBeInTheDocument();
  });
});
