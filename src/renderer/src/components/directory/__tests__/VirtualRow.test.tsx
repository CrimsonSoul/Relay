import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Contact } from '@shared/ipc';
import { VirtualRow } from '../VirtualRow';

const ADA: Contact = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  title: 'Engineer',
  phone: '',
  _searchString: 'ada lovelace ada@example.com engineer',
  raw: { id: 'contact-1' },
};

describe('Directory VirtualRow', () => {
  it('renders the contact inside a positioned list item', () => {
    const onRowClick = vi.fn();
    render(
      <div role="list">
        <VirtualRow
          index={0}
          style={{ position: 'absolute', top: 0, height: 60 }}
          ariaAttributes={{ role: 'listitem', 'aria-posinset': 1, 'aria-setsize': 3 }}
          filtered={[ADA]}
          groupMap={new Map()}
          serverRelationMap={new Map()}
          onContextMenu={vi.fn()}
          onOpenActions={vi.fn()}
          focusedIndex={-1}
          menuTargetIndex={-1}
          onRowClick={onRowClick}
        />
      </div>,
    );

    const item = screen.getByRole('listitem');
    expect(item).toHaveAttribute('aria-posinset', '1');
    expect(item).toHaveAttribute('aria-setsize', '3');
    expect(item).toHaveStyle({ position: 'absolute', top: '0px', height: '60px' });
    fireEvent.click(within(item).getByText('Ada Lovelace'));
    expect(onRowClick).toHaveBeenCalledWith(0);
  });
});
