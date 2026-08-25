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
        downloadState="idle"
        onPreviousPage={vi.fn()}
        onNextPage={vi.fn()}
        onZoomOut={vi.fn()}
        onZoomIn={vi.fn()}
        onFitWidth={vi.fn()}
        onSelectViewMode={onSelectViewMode}
        onDownload={vi.fn()}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'View options: Single page' });
    expect(screen.getByRole('heading', { level: 1, name: 'Operator guide' })).toBeInTheDocument();
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

  it('exposes an accessible download action and reports its in-progress state', () => {
    const onDownload = vi.fn();
    const props = {
      category: 'General',
      title: 'Operator guide',
      pageIndex: 0,
      pageCount: 3,
      scale: 1,
      viewMode: 'continuous' as const,
      downloadState: 'idle' as const,
      onPreviousPage: vi.fn(),
      onNextPage: vi.fn(),
      onZoomOut: vi.fn(),
      onZoomIn: vi.fn(),
      onFitWidth: vi.fn(),
      onSelectViewMode: vi.fn(),
      onDownload,
    };
    const view = render(<KnowledgePdfToolbar {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(onDownload).toHaveBeenCalledOnce();

    view.rerender(<KnowledgePdfToolbar {...props} downloadState="downloading" />);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled();
    expect(screen.getByText('Downloading…')).toBeInTheDocument();
  });
});
