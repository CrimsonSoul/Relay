import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';
import { vi } from 'vitest';

describe('ErrorBoundary Component', () => {
  beforeEach(() => {
    // Mock globalThis.location.reload using Object.defineProperty
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

    expect(globalThis.location.reload).toHaveBeenCalled();
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

  it('renders ReactNode fallback when provided', () => {
    const ThrowError = () => {
      throw new Error('Test error');
    };

    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">Custom fallback</div>}>
        <ThrowError />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.getByText('Custom fallback')).toBeInTheDocument();
    // Default error UI should NOT be shown
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  });

  it('renders function fallback with reset callback when provided', () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error('Test error');
      return <div>Recovered content</div>;
    };

    const FallbackFn = (reset: () => void) => (
      <div>
        <span>Function fallback rendered</span>
        <button onClick={reset}>Reset</button>
      </div>
    );

    render(
      <ErrorBoundary fallback={FallbackFn}>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Function fallback rendered')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

    // Stop throwing before reset
    shouldThrow = false;

    // Click reset to clear error state
    fireEvent.click(screen.getByText('Reset'));

    expect(screen.getByText('Recovered content')).toBeInTheDocument();
  });

  it('resets error state when Try Again button is clicked', () => {
    let shouldThrow = true;
    const MaybeThrow = () => {
      if (shouldThrow) throw new Error('Test error');
      return <div>Normal after reset</div>;
    };

    render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Stop throwing before reset
    shouldThrow = false;

    // Click "Try Again"
    fireEvent.click(screen.getByText('Try Again'));

    expect(screen.getByText('Normal after reset')).toBeInTheDocument();
  });
});
