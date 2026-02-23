import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CollapsibleHeader, useCollapsibleHeader } from '../CollapsibleHeader';

describe('CollapsibleHeader', () => {
  it('renders title', () => {
    render(<CollapsibleHeader title="Test Title" />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders subtitle', () => {
    render(<CollapsibleHeader title="Title" subtitle="Subtitle text" />);
    expect(screen.getByText('Subtitle text')).toBeInTheDocument();
  });

  it('renders children (toolbar buttons)', () => {
    render(
      <CollapsibleHeader title="Title">
        <button>Action</button>
      </CollapsibleHeader>,
    );
    expect(screen.getByText('Action')).toBeInTheDocument();
  });

  it('renders multiple children', () => {
    render(
      <CollapsibleHeader title="Title">
        <button>Add</button>
        <button>Remove</button>
      </CollapsibleHeader>,
    );
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('renders subtitle as ReactNode', () => {
    render(
      <CollapsibleHeader
        title="Title"
        subtitle={<span data-testid="custom-subtitle">Custom</span>}
      />,
    );
    expect(screen.getByTestId('custom-subtitle')).toBeInTheDocument();
  });

  it('applies collapsed CSS class when isCollapsed is true', () => {
    const { container } = render(<CollapsibleHeader title="Title" isCollapsed={true} />);
    expect(container.querySelector('.collapsible-header--collapsed')).not.toBeNull();
  });

  it('applies expanded CSS class when isCollapsed is false', () => {
    const { container } = render(<CollapsibleHeader title="Title" isCollapsed={false} />);
    expect(container.querySelector('.collapsible-header--expanded')).not.toBeNull();
  });

  it('does not render title/subtitle section when neither is provided', () => {
    const { container } = render(<CollapsibleHeader />);
    expect(container.querySelector('.collapsible-header-left')).toBeNull();
  });

  it('does not render children section when no children', () => {
    const { container } = render(<CollapsibleHeader title="Title" />);
    expect(container.querySelector('.collapsible-header-right')).toBeNull();
  });

  it('applies custom style prop', () => {
    const { container } = render(
      <CollapsibleHeader title="Title" style={{ backgroundColor: 'red' }} />,
    );
    const headerEl = container.querySelector('.collapsible-header') as HTMLElement;
    expect(headerEl.style.backgroundColor).toBe('red');
  });
});

describe('useCollapsibleHeader', () => {
  const ScrollTestComponent = () => {
    const { isCollapsed, scrollContainerRef } = useCollapsibleHeader(50);
    return (
      <div ref={scrollContainerRef} data-testid="container">
        <div data-testid="status">{isCollapsed ? 'collapsed' : 'expanded'}</div>
      </div>
    );
  };

  it('starts not collapsed', () => {
    const TestComponent = () => {
      const { isCollapsed, scrollContainerRef } = useCollapsibleHeader();
      return (
        <div ref={scrollContainerRef} data-testid="container" style={{ overflow: 'auto' }}>
          <div data-testid="status">{isCollapsed ? 'collapsed' : 'expanded'}</div>
        </div>
      );
    };
    render(<TestComponent />);
    expect(screen.getByTestId('status')).toHaveTextContent('expanded');
  });

  it('collapses when scroll exceeds threshold', async () => {
    render(<ScrollTestComponent />);
    const container = screen.getByTestId('container');
    // Simulate scroll beyond threshold
    Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true });
    await act(async () => {
      fireEvent.scroll(container);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('collapsed');
  });

  it('uncollapses when scroll is below threshold', async () => {
    render(<ScrollTestComponent />);
    const container = screen.getByTestId('container');
    // Scroll past threshold
    Object.defineProperty(container, 'scrollTop', { value: 100, configurable: true });
    await act(async () => {
      fireEvent.scroll(container);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('collapsed');
    // Scroll back
    Object.defineProperty(container, 'scrollTop', { value: 10, configurable: true });
    await act(async () => {
      fireEvent.scroll(container);
    });
    expect(screen.getByTestId('status')).toHaveTextContent('expanded');
  });
});
