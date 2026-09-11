import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SortableEditRow } from '../SortableEditRow';
import { formatPhoneNumber } from '@shared/phoneUtils';
it('selects the exact same-name contact from the real combobox', () => {
  const onUpdate = vi.fn();
  const contacts = [
    {
      name: 'Alex',
      email: 'first@example.com',
      phone: '5551112222',
      title: 'First',
      raw: { id: 'first' },
      _searchString: 'alex',
    },
    {
      name: 'Alex',
      email: 'second@example.com',
      phone: '5553334444',
      title: 'Second',
      raw: { id: 'second' },
      _searchString: 'alex',
    },
  ];
  render(
    <SortableEditRow
      row={{
        id: 'row',
        teamId: 'team-alpha',
        team: 'Alpha',
        role: 'Primary',
        name: '',
        contact: '',
      }}
      contacts={contacts}
      onUpdate={onUpdate}
      onRemove={vi.fn()}
    />,
  );
  fireEvent.focus(screen.getByPlaceholderText('Select Contact...'));
  fireEvent.click(screen.getByRole('button', { name: 'AlexSecond' }));
  expect(onUpdate).toHaveBeenLastCalledWith(
    expect.objectContaining({ name: 'Alex', contact: formatPhoneNumber('5553334444') }),
  );
});
