import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DynatraceProblemNoteBody } from '../DynatraceProblemNoteBody';

describe('DynatraceProblemNoteBody', () => {
  const renderNote = (disabled: boolean, onEdit = vi.fn(async () => undefined)) => {
    const view = render(
      <DynatraceProblemNoteBody
        text="Vendor paged"
        label="note by Ryan"
        disabled={disabled}
        onEdit={onEdit}
        onDelete={vi.fn(async () => undefined)}
      >
        <p>Vendor paged</p>
      </DynatraceProblemNoteBody>,
    );
    return { ...view, onEdit };
  };

  it('saves with Ctrl+Enter while saving is allowed', () => {
    const { onEdit } = renderNote(false);
    fireEvent.click(screen.getByRole('button', { name: 'Edit note by Ryan' }));
    const editor = screen.getByRole('textbox', { name: 'Edit note by Ryan' });
    fireEvent.change(editor, { target: { value: 'Vendor on site' } });
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });

    expect(onEdit).toHaveBeenCalledWith('Vendor on site');
  });

  it('keeps Ctrl+Enter from saving once saving is blocked mid-edit', () => {
    const onEdit = vi.fn(async () => undefined);
    const { rerender } = renderNote(false, onEdit);
    fireEvent.click(screen.getByRole('button', { name: 'Edit note by Ryan' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit note by Ryan' }), {
      target: { value: 'Vendor on site' },
    });

    rerender(
      <DynatraceProblemNoteBody
        text="Vendor paged"
        label="note by Ryan"
        disabled
        onEdit={onEdit}
        onDelete={vi.fn(async () => undefined)}
      >
        <p>Vendor paged</p>
      </DynatraceProblemNoteBody>,
    );
    const editor = screen.getByRole('textbox', { name: 'Edit note by Ryan' });
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true });

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(editor).toHaveValue('Vendor on site');
  });
});
