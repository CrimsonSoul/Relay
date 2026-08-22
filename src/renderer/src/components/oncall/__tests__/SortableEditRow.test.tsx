import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ChangeEvent, ChangeEventHandler, FocusEventHandler } from 'react';
import { SortableEditRow } from '../SortableEditRow';
import { formatPhoneNumber } from '@shared/phoneUtils';
import type { Contact, OnCallRow } from '@shared/ipc';

type MockTransform = { x: number; y: number } | null | undefined;

type MockInputProps = {
  value?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
  onBlur?: FocusEventHandler<HTMLInputElement>;
  placeholder?: string;
  className?: string;
};

type MockComboboxOption = {
  value: string;
  label: string;
};

type MockComboboxProps = {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  options?: MockComboboxOption[];
  onOpenChange?: (isOpen: boolean) => void;
};

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockUseSortable = vi.fn().mockReturnValue({
  attributes: { role: 'button' },
  listeners: {},
  setNodeRef: vi.fn(),
  transform: null,
  transition: undefined,
  isDragging: false,
});

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: (...args: unknown[]) => mockUseSortable(...args),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Translate: {
      toString: (t: MockTransform) => (t ? `translate(${t.x}px, ${t.y}px)` : undefined),
    },
  },
}));

vi.mock('../../../components/Input', () => ({
  Input: ({ value, onChange, onBlur, placeholder, className }: MockInputProps) => (
    <input
      value={value || ''}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      className={className}
      data-testid={`input-${placeholder?.toLowerCase().replace(/\s/g, '-')}`}
    />
  ),
}));

vi.mock('../../../components/Combobox', () => ({
  Combobox: ({ value, onChange, placeholder, options, onOpenChange }: MockComboboxProps) => (
    <select
      value={value || ''}
      onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      data-testid={`combobox-${placeholder
        ?.toLowerCase()
        .split(/[\s.]+/)
        .filter(Boolean)
        .join('-')}`}
      onFocus={() => onOpenChange?.(true)}
      onBlur={() => onOpenChange?.(false)}
    >
      <option value="">-- {placeholder} --</option>
      {options?.map((opt: MockComboboxOption) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock('@shared/phoneUtils', () => ({
  formatPhoneNumber: vi.fn((phone: string) => `+1${phone.replace(/\D/g, '')}`),
}));

// ── Test Data ──────────────────────────────────────────────────────────────────

const mockRow: OnCallRow = {
  id: 'row-1',
  team: 'Alpha',
  teamId: 'team-1',
  role: 'Primary',
  name: 'John Doe',
  contact: '5551234567',
  timeWindow: '9AM-5PM',
};

const makeContact = (
  id: string,
  name: string,
  phone: string,
  email: string,
  title: string,
): Contact => ({
  name,
  phone,
  email,
  title,
  _searchString: `${name} ${email} ${title}`.toLowerCase(),
  raw: { id },
});

const mockContacts: Contact[] = [
  makeContact('c1', 'John Doe', '5551234567', 'john@test.com', 'Engineer'),
  makeContact('c2', 'Jane Smith', '5559876543', 'jane@test.com', 'Manager'),
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SortableEditRow', () => {
  let onUpdate: Mock<(row: OnCallRow) => void>;
  let onRemove: Mock<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    onUpdate = vi.fn<(row: OnCallRow) => void>();
    onRemove = vi.fn<() => void>();
    mockUseSortable.mockReturnValue({
      attributes: { role: 'button' },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    });
  });

  const renderRow = (overrides?: Partial<typeof mockRow>) =>
    render(
      <SortableEditRow
        row={{ ...mockRow, ...overrides }}
        contacts={mockContacts}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    );

  it('renders all fields with correct values', () => {
    renderRow();

    const roleCombobox = screen.getByTestId('combobox-role');
    expect(roleCombobox).toHaveValue('Primary');

    const nameCombobox = screen.getByTestId('combobox-select-contact');
    expect(nameCombobox).toHaveValue('John Doe');

    const phoneInput = screen.getByTestId('input-phone');
    expect(phoneInput).toHaveValue('5551234567');

    const timeInput = screen.getByTestId('input-time-window');
    expect(timeInput).toHaveValue('9AM-5PM');

    expect(screen.getByLabelText('Remove row')).toBeInTheDocument();
  });

  it('calls onUpdate with new role when role combobox changes', () => {
    renderRow();

    fireEvent.change(screen.getByTestId('combobox-role'), { target: { value: 'Backup' } });

    expect(onUpdate).toHaveBeenCalledWith({ ...mockRow, role: 'Backup' });
  });

  it('auto-fills phone when name matches a contact with phone', () => {
    renderRow({ name: '', contact: '' });

    fireEvent.change(screen.getByTestId('combobox-select-contact'), {
      target: { value: 'Jane Smith' },
    });

    expect(formatPhoneNumber).toHaveBeenCalledWith('5559876543');
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Jane Smith',
        contact: '+15559876543',
      }),
    );
  });

  it('does not auto-fill phone when matching contact has no phone', () => {
    const contactsNoPhone = [makeContact('c3', 'No Phone', '', 'no@test.com', 'Intern')];

    render(
      <SortableEditRow
        row={{ ...mockRow, name: '', contact: '' }}
        contacts={contactsNoPhone}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(screen.getByTestId('combobox-select-contact'), {
      target: { value: 'No Phone' },
    });

    expect(formatPhoneNumber).not.toHaveBeenCalled();
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'No Phone', contact: '' }),
    );
  });

  it('clears the previous number when the newly picked contact has no phone', () => {
    // The board must never show one person's name beside another's number.
    const contactsNoPhone = [makeContact('c3', 'No Phone', '', 'no@test.com', 'Intern')];

    render(
      <SortableEditRow
        row={{ ...mockRow, name: 'John Doe', contact: '5551234567' }}
        contacts={contactsNoPhone}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(screen.getByTestId('combobox-select-contact'), {
      target: { value: 'No Phone' },
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'No Phone', contact: '' }),
    );
  });

  it('leaves a hand-entered number alone when the name matches no contact', () => {
    // Only a directory match may overwrite the phone; anything else (free text,
    // or clearing the name) must leave a manually entered number untouched.
    renderRow({ name: 'John Doe', contact: '5551112222' });

    fireEvent.change(screen.getByTestId('combobox-select-contact'), {
      target: { value: '' },
    });

    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ name: '', contact: '5551112222' }),
    );
  });

  it('calls onUpdate when phone input changes', () => {
    renderRow();

    fireEvent.change(screen.getByTestId('input-phone'), {
      target: { value: '5550001111' },
    });

    expect(onUpdate).toHaveBeenCalledWith({ ...mockRow, contact: '5550001111' });
  });

  it('formats phone number on blur', () => {
    renderRow();

    fireEvent.blur(screen.getByTestId('input-phone'));

    expect(formatPhoneNumber).toHaveBeenCalledWith('5551234567');
    expect(onUpdate).toHaveBeenCalledWith({ ...mockRow, contact: '+15551234567' });
  });

  it('calls onUpdate when time window input changes', () => {
    renderRow();

    fireEvent.change(screen.getByTestId('input-time-window'), {
      target: { value: '8AM-6PM' },
    });

    expect(onUpdate).toHaveBeenCalledWith({ ...mockRow, timeWindow: '8AM-6PM' });
  });

  it('calls onRemove when remove button is clicked', () => {
    renderRow();

    fireEvent.click(screen.getByLabelText('Remove row'));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('calls onRemove when Enter key is pressed on remove button', () => {
    renderRow();

    fireEvent.keyDown(screen.getByLabelText('Remove row'), { key: 'Enter' });

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('calls onRemove when Space key is pressed on remove button', () => {
    renderRow();

    fireEvent.keyDown(screen.getByLabelText('Remove row'), { key: ' ' });

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('applies isDragging styles: opacity 0.4, zIndex 1000, scale 1.02', () => {
    mockUseSortable.mockReturnValue({
      attributes: { role: 'button' },
      listeners: {},
      setNodeRef: vi.fn(),
      transform: { x: 10, y: 20, scaleX: 1, scaleY: 1 },
      transition: 'transform 200ms',
      isDragging: true,
    });

    const { container } = renderRow();
    const outerDiv = container.firstChild as HTMLElement;

    expect(outerDiv.style.opacity).toBe('0.4');
    expect(outerDiv.style.zIndex).toBe('1000');
    expect(outerDiv.style.scale).toBe('1.02');
    expect(outerDiv.style.transform).toBe('translate(10px, 20px)');
  });

  it('applies isActive zIndex 100 when a combobox is focused', () => {
    const { container } = renderRow();

    fireEvent.focus(screen.getByTestId('combobox-role'));

    const outerDiv = container.firstChild as HTMLElement;
    expect(outerDiv.style.zIndex).toBe('100');
  });

  it('has zIndex auto in normal state', () => {
    const { container } = renderRow();
    const outerDiv = container.firstChild as HTMLElement;

    expect(outerDiv.style.zIndex).toBe('auto');
  });
});
