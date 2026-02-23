import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AddServerModal } from '../AddServerModal';

// Mock globalThis.api
const mockApi = {
  addServer: vi.fn(),
};

describe('AddServerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as Record<string, unknown>).api = mockApi;
  });

  it('does not render when isOpen is false', () => {
    render(<AddServerModal isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText('Add Server')).toBeNull();
  });

  it('renders with title Add Server when no serverToEdit', () => {
    render(<AddServerModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Add Server')).toBeInTheDocument();
  });

  it('renders with title Edit Server when serverToEdit provided', () => {
    const server = {
      id: '1',
      name: 'SRV-001',
      businessArea: '',
      lob: '',
      comment: '',
      owner: '',
      contact: '',
      os: '',
    };
    render(<AddServerModal isOpen={true} onClose={vi.fn()} serverToEdit={server} />);
    expect(screen.getByText('Edit Server')).toBeInTheDocument();
  });

  it('populates form with serverToEdit values', () => {
    const server = {
      id: '1',
      name: 'SRV-001',
      businessArea: 'Finance',
      lob: 'Loans',
      comment: 'Notes here',
      owner: 'owner@example.com',
      contact: 'support@example.com',
      os: 'Linux',
    };
    render(<AddServerModal isOpen={true} onClose={vi.fn()} serverToEdit={server} />);
    expect(screen.getByDisplayValue('SRV-001')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Finance')).toBeInTheDocument();
  });

  it('Save Server button is disabled when name is empty', () => {
    render(<AddServerModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Save Server').closest('button')).toBeDisabled();
  });

  it('Save Server button is enabled when name is filled', () => {
    render(<AddServerModal isOpen={true} onClose={vi.fn()} />);
    const nameInput = screen.getByPlaceholderText('e.g. SRV-001');
    fireEvent.change(nameInput, { target: { value: 'NewServer' } });
    expect(screen.getByText('Save Server').closest('button')).not.toBeDisabled();
  });

  it('calls api.addServer and onClose on successful submit', async () => {
    mockApi.addServer.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<AddServerModal isOpen={true} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. SRV-001'), {
      target: { value: 'TestServer' },
    });
    fireEvent.click(screen.getByText('Save Server'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows error when api.addServer returns failure', async () => {
    mockApi.addServer.mockResolvedValue({ success: false, error: 'Duplicate name' });
    render(<AddServerModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. SRV-001'), {
      target: { value: 'TestServer' },
    });
    fireEvent.click(screen.getByText('Save Server'));
    await vi.waitFor(() => expect(screen.getByText('Duplicate name')).toBeInTheDocument());
  });

  it('shows error when no api available', async () => {
    (globalThis as unknown as Record<string, unknown>).api = undefined;
    render(<AddServerModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('e.g. SRV-001'), {
      target: { value: 'TestServer' },
    });
    fireEvent.click(screen.getByText('Save Server'));
    await vi.waitFor(() => expect(screen.getByText('API not available')).toBeInTheDocument());
  });
});
