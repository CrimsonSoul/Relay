import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { Contact } from '@shared/ipc';
import { ContactCard } from '../../ContactCard';
import { DirectoryContextMenu } from '../DirectoryContextMenu';
import { RowActionsButton, type RowMenuAnchor } from '../RowActionsButton';

const contact: Contact = {
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: '',
  title: 'Analyst',
  _searchString: 'ada lovelace',
  raw: {},
};

/** A Contacts row wired the way DirectoryTab wires it: the `⋯` anchor opens the row's menu. */
function ContactRowWithMenu() {
  const [anchor, setAnchor] = useState<RowMenuAnchor | null>(null);
  return (
    <>
      <ContactCard
        name={contact.name}
        email={contact.email}
        title={contact.title}
        onRowClick={vi.fn()}
        onOpenActions={setAnchor}
      />
      {anchor && (
        <DirectoryContextMenu
          x={anchor.x}
          y={anchor.y}
          contact={contact}
          recentlyAdded={new Set()}
          onClose={() => setAnchor(null)}
          onAddToBridge={vi.fn()}
          onManageGroups={vi.fn()}
          onEditContact={vi.fn()}
          onDeleteContact={vi.fn()}
          onEditNotes={vi.fn()}
        />
      )}
    </>
  );
}

describe('RowActionsButton', () => {
  it('names the row and announces a menu', () => {
    render(<RowActionsButton name="Ada Lovelace" onOpen={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Actions for Ada Lovelace' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Shift+F10');
    expect(button).toHaveClass('tactile-button--icon-only');
  });

  it('shows its name as the tooltip without describing itself a second time', () => {
    render(<RowActionsButton name="Ada Lovelace" onOpen={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Actions for Ada Lovelace' });
    fireEvent.mouseEnter(button);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Actions for Ada Lovelace');
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('opens the anchored menu without letting the click reach the window close handler', () => {
    const onOpen = vi.fn();
    const windowClick = vi.fn();
    globalThis.addEventListener('click', windowClick);
    render(<RowActionsButton name="Ada Lovelace" onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: 'Actions for Ada Lovelace' });
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 300,
      bottom: 140,
    } as DOMRect);
    fireEvent.click(button);
    globalThis.removeEventListener('click', windowClick);

    expect(onOpen).toHaveBeenCalledWith({ x: 300, y: 140 });
    expect(windowClick).not.toHaveBeenCalled();
  });

  it('answers Shift+F10 itself and keeps Enter from reaching the list', () => {
    const onOpen = vi.fn();
    const listKeyDown = vi.fn();
    render(
      // eslint-disable-next-line jsx-a11y/no-static-element-interactions
      <div onKeyDown={listKeyDown}>
        <RowActionsButton name="Ada Lovelace" onOpen={onOpen} />
      </div>,
    );

    const button = screen.getByRole('button', { name: 'Actions for Ada Lovelace' });
    fireEvent.keyDown(button, { key: 'Enter' });
    fireEvent.keyDown(button, { key: 'F10', shiftKey: true });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(listKeyDown).not.toHaveBeenCalled();
  });

  it("opens a contact row's menu, Add to Bridge first", () => {
    render(<ContactRowWithMenu />);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Ada Lovelace' }));

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Add to Bridge',
      'Manage Groups',
      'Add Notes',
      'Edit Contact',
      'Delete',
    ]);
  });
});
