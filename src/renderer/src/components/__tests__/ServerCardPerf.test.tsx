import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ServerCard } from '../ServerCard';
import { Server, Contact } from '@shared/ipc';

// Mock data
const mockServer: Server = {
  id: '1',
  name: 'Test Server',
  os: 'Windows',
  businessArea: 'Test',
  lob: 'Test LOB',
  owner: 'Owner',
  contact: 'Contact',
  comment: 'Comment',
  status: 'active',
  ip: '127.0.0.1',
  port: 8080,
  tags: []
};

const mockContactLookup = new Map<string, Contact>();

describe('ServerCard Performance', () => {
  let resizeObserverMock: any;
  let observeMock: any;
  let disconnectMock: any;

  beforeEach(() => {
    observeMock = vi.fn();
    disconnectMock = vi.fn();
    resizeObserverMock = vi.fn(function() {
      return {
        observe: observeMock,
        disconnect: disconnectMock,
        unobserve: vi.fn(),
      };
    });
    window.ResizeObserver = resizeObserverMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does NOT instantiate ResizeObserver on mount', () => {
    render(
      <ServerCard
        server={mockServer}
        contactLookup={mockContactLookup}
        onContextMenu={() => {}}
        isWide={false}
      />
    );

    expect(resizeObserverMock).not.toHaveBeenCalled();
    expect(observeMock).not.toHaveBeenCalled();
  });
});
