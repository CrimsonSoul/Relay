import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { TagInput } from '../../notes/TagInput';

describe('TagInput', () => {
  it('renders the input with placeholder', () => {
    render(<TagInput value="" onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={vi.fn()} />);
    expect(screen.getByPlaceholderText('Add a tag...')).toBeInTheDocument();
  });

  it('renders with supplied id', () => {
    render(
      <TagInput id="tag-field" value="" onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={vi.fn()} />,
    );
    expect(screen.getByPlaceholderText('Add a tag...')).toHaveAttribute('id', 'tag-field');
  });

  it('calls onChange when user types', () => {
    const onChange = vi.fn();
    render(<TagInput value="" onChange={onChange} onAdd={vi.fn()} onKeyDown={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Add a tag...'), {
      target: { value: 'new-tag' },
    });
    expect(onChange).toHaveBeenCalledWith('new-tag');
  });

  it('calls onKeyDown on keydown events', () => {
    const onKeyDown = vi.fn();
    render(<TagInput value="x" onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={onKeyDown} />);
    fireEvent.keyDown(screen.getByPlaceholderText('Add a tag...'), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('Add button is disabled when value is empty', () => {
    render(<TagInput value="" onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={vi.fn()} />);
    expect(screen.getByText('Add')).toBeDisabled();
  });

  it('Add button is disabled when value is whitespace only', () => {
    render(<TagInput value="   " onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={vi.fn()} />);
    expect(screen.getByText('Add')).toBeDisabled();
  });

  it('Add button is enabled when value is non-empty', () => {
    render(<TagInput value="tag" onChange={vi.fn()} onAdd={vi.fn()} onKeyDown={vi.fn()} />);
    expect(screen.getByText('Add')).not.toBeDisabled();
  });

  it('calls onAdd when Add button is clicked', () => {
    const onAdd = vi.fn();
    render(<TagInput value="mytag" onChange={vi.fn()} onAdd={onAdd} onKeyDown={vi.fn()} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onAdd).toHaveBeenCalled();
  });
});
