import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { VirtualRow } from '../VirtualRow';

describe('VirtualRow', () => {
  it('renders the recipient inside a positioned list item', () => {
    render(
      <div role="list">
        <VirtualRow
          index={1}
          style={{ position: 'absolute', top: 67, height: 67 }}
          ariaAttributes={{ role: 'listitem', 'aria-posinset': 2, 'aria-setsize': 2 }}
          log={[
            { email: 'ada@example.com', source: 'group' },
            { email: 'grace@example.com', source: 'manual' },
          ]}
          contactMap={new Map()}
          groupMap={new Map()}
          onRemoveManual={vi.fn()}
          onContextMenu={vi.fn()}
        />
      </div>,
    );

    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('aria-posinset', '2');
    expect(item).toHaveAttribute('aria-setsize', '2');
    expect(item).toHaveStyle({ position: 'absolute', top: '67px', height: '67px' });
    expect(within(item).getByText('grace@example.com')).toBeInTheDocument();
    expect(within(item).getByText('Manual')).toBeInTheDocument();
  });
});
