import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Contact } from '@shared/ipc';
import { TeamCard } from '../TeamCard';

describe('TeamCard keyboard menu', () => {
  it('ignores Shift+F10 typed inside its portaled Edit Team dialog', () => {
    const setMenu = vi.fn();
    render(
      <TeamCard
        team="Alpha"
        rows={[]}
        contacts={[] as Contact[]}
        onUpdateRows={vi.fn()}
        onRenameTeam={vi.fn()}
        onRemoveTeam={vi.fn()}
        setConfirm={vi.fn()}
        setMenu={setMenu}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Assign On-Call for Alpha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Row' }));

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Phone' }), {
      key: 'F10',
      shiftKey: true,
    });
    expect(setMenu).not.toHaveBeenCalled();

    fireEvent.keyDown(screen.getByRole('group', { name: 'Alpha team' }), {
      key: 'F10',
      shiftKey: true,
    });
    expect(setMenu).toHaveBeenCalledOnce();
  });
});
