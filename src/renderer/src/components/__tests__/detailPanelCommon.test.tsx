import React from 'react';
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

  it('applies default variant class', () => {
    const { container } = render(
      <DetailActionButton label="X" onClick={vi.fn()} icon={<span />} />,
    );
    expect(container.querySelector('.detail-panel-action-btn')).toBeInTheDocument();
  });

  it('applies primary variant class', () => {
    const { container } = render(
      <DetailActionButton label="X" onClick={vi.fn()} icon={<span />} variant="primary" />,
    );
    expect(container.querySelector('.detail-panel-action-btn--primary')).toBeInTheDocument();
  });

  it('applies danger variant class', () => {
    const { container } = render(
      <DetailActionButton label="X" onClick={vi.fn()} icon={<span />} variant="danger" />,
    );
    expect(container.querySelector('.detail-panel-action-btn--danger')).toBeInTheDocument();
  });
});

describe('DetailField', () => {
  it('renders label and value', () => {
    render(<DetailField label="EMAIL" value="test@example.com" />);
    expect(screen.getByText('EMAIL')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  it('applies custom valueClassName', () => {
    const { container } = render(
      <DetailField label="STATUS" value="Active" valueClassName="status-active" />,
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

  it('renders TAGS section label', () => {
    render(<DetailTagsSection tags={['foo']} />);
    expect(screen.getByText('TAGS')).toBeInTheDocument();
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
    expect(screen.getByText('NOTES')).toBeInTheDocument();
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
