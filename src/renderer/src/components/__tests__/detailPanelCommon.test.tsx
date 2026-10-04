import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  DetailActionButton,
  DetailField,
  DetailTagsSection,
  DetailNotesSection,
  AddIcon,
  NotesIcon,
  EditIcon,
  DeleteIcon,
} from '../detailPanelCommon';

describe('DetailActionButton', () => {
  it('renders label and calls onClick', () => {
    const onClick = vi.fn();
    render(<DetailActionButton label="Edit" onClick={onClick} icon={<span>icon</span>} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Edit'));
    expect(onClick).toHaveBeenCalled();
  });

  it('renders the default variant as a full-width secondary TactileButton', () => {
    render(<DetailActionButton label="X" onClick={vi.fn()} icon={<span />} />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveClass(
      'tactile-button--secondary',
      'is-block',
    );
  });

  it('renders the primary variant as a primary TactileButton', () => {
    render(<DetailActionButton label="X" onClick={vi.fn()} icon={<span />} variant="primary" />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveClass('tactile-button--primary');
  });

  it('renders the danger variant as a danger TactileButton', () => {
    render(<DetailActionButton label="X" onClick={vi.fn()} icon={<span />} variant="danger" />);
    expect(screen.getByRole('button', { name: 'X' })).toHaveClass('tactile-button--danger');
  });

  it('shows a short verb and carries the full command name in aria-label and tooltip', () => {
    render(
      <DetailActionButton
        label="Edit"
        accessibleLabel="Edit Contact"
        onClick={vi.fn()}
        icon={<span />}
      />,
    );
    const button = screen.getByRole('button', { name: 'Edit Contact' });
    expect(button).toHaveTextContent('Edit');
    expect(button).not.toHaveTextContent('Edit Contact');

    fireEvent.mouseEnter(button);

    expect(document.body.querySelector('.tooltip-popup')).toHaveTextContent('Edit Contact');
  });
});

describe('DetailField', () => {
  it('renders label and value', () => {
    render(<DetailField label="Email" value="test@example.com" />);
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('applies custom valueClassName', () => {
    const { container } = render(
      <DetailField label="Status" value="Active" valueClassName="status-active" />,
    );
    expect(container.querySelector('.status-active')).toBeInTheDocument();
  });
});

describe('DetailTagsSection', () => {
  it('renders nothing when tags is empty', () => {
    const { container } = render(<DetailTagsSection tags={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders tags with # prefix', () => {
    render(<DetailTagsSection tags={['alpha', 'beta']} />);
    expect(screen.getByText('#alpha')).toBeInTheDocument();
    expect(screen.getByText('#beta')).toBeInTheDocument();
  });

  it('renders the Tags section label', () => {
    render(<DetailTagsSection tags={['foo']} />);
    expect(screen.getByText('Tags')).toBeInTheDocument();
  });
});

describe('DetailNotesSection', () => {
  it('renders nothing when noteText is undefined', () => {
    const { container } = render(<DetailNotesSection />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when noteText is empty string', () => {
    const { container } = render(<DetailNotesSection noteText="" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders note text', () => {
    render(<DetailNotesSection noteText="Some notes here" />);
    expect(screen.getByText('Some notes here')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });
});

describe('Icon components', () => {
  it('AddIcon renders an SVG', () => {
    const { container } = render(<AddIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('NotesIcon renders an SVG', () => {
    const { container } = render(<NotesIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('EditIcon renders an SVG', () => {
    const { container } = render(<EditIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('DeleteIcon renders an SVG', () => {
    const { container } = render(<DeleteIcon />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
