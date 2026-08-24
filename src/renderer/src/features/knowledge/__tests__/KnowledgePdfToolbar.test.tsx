import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgePdfToolbar } from '../KnowledgePdfToolbar';

describe('KnowledgePdfToolbar', () => {
  it('owns its view popover while forwarding reader actions', async () => {
    const onSelectViewMode = vi.fn();
    render(
      <KnowledgePdfToolbar
        category="General"
        title="Operator guide"
        currentSection="Recovery"
        toolbarLeading={<button type="button">Back to Wiki</button>}
        pageIndex={1}
        pageCount={3}
        scale={1}
        viewMode="single"
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitWidth={vi.fn()}
        onSelectViewMode={onSelectViewMode}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'View options: Single page' });
    fireEvent.click(trigger);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'View options' })).getByRole('button', {
        name: 'Continuous scrolling',
      }),
    );

    expect(onSelectViewMode).toHaveBeenCalledWith('continuous');
    expect(screen.queryByRole('dialog', { name: 'View options' })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
