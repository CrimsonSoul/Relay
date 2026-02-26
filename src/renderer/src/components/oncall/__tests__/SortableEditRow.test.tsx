import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableEditRow } from '../SortableEditRow';
import { formatPhoneNumber } from '@shared/phoneUtils';

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
  useSortable: (...args: any[]) => mockUseSortable(...args),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Translate: { toString: (t: any) => (t ? `translate(${t.x}px, ${t.y}px)` : undefined) } },
}));

vi.mock('../../../components/Input', () => ({
  Input: ({ value, onChange, onBlur, placeholder, className }: any) => (
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
  Combobox: ({ value, onChange, placeholder, options, onOpenChange }: any) => (
    <select
      value={value || ''}
      onChange={(e: any) => onChange(e.target.value)}
      data-testid={`combobox-${placeholder
        ?.toLowerCase()
        .split(/[\s.]+/)
        .filter(Boolean)
        .join('-')}`}
      onFocus={() => onOpenChange?.(true)}
      onBlur={() => onOpenChange?.(false)}
    >
      <option value="">-- {placeholder} --</option>
      {options?.map((opt: any) => (
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

const mockRow = {
  id: 'row-1',
  role: 'Primary',
  name: 'John Doe',
  contact: '5551234567',
  timeWindow: '9AM-5PM',
};

const mockContacts = [
  { id: 'c1', name: 'John Doe', phone: '5551234567', email: 'john@test.com', title: 'Engineer' },
  { id: 'c2', name: 'Jane Smith', phone: '5559876543', email: 'jane@test.com', title: 'Manager' },
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('SortableEditRow', () => {
  let onUpdate: ReturnType<typeof vi.fn>;
  let onRemove: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onUpdate = vi.fn();
    onRemove = vi.fn();
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
    const contactsNoPhone = [
      { id: 'c3', name: 'No Phone', phone: '', email: 'no@test.com', title: 'Intern' },
    ];

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
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'No Phone' }));
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
