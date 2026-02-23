import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TagBadge } from '../../notes/TagBadge';

describe('TagBadge', () => {
  it('renders the tag text with a hash prefix', () => {
    render(<TagBadge tag="urgent" onRemove={vi.fn()} />);
    expect(screen.getByText('#urgent')).toBeInTheDocument();
  });

  it('renders a remove button with correct aria-label', () => {
    render(<TagBadge tag="ops" onRemove={vi.fn()} />);
    expect(screen.getByLabelText('Remove tag ops')).toBeInTheDocument();
  });

  it('calls onRemove with the tag when remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<TagBadge tag="priority" onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText('Remove tag priority'));
    expect(onRemove).toHaveBeenCalledWith('priority');
  });
});
