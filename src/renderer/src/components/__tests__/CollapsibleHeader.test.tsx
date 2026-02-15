import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CollapsibleHeader } from '../CollapsibleHeader';

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
});
