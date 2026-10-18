import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebUploadRecovery } from '../WebUploadRecovery';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.api = undefined;
});
it('offers reselection for a transfer found after remount and refreshes after recovery', async () => {
  let pending: unknown = {
    batchId: 'batch',
    files: [{ id: 'file', name: 'Runbook.pdf', size: 12 }],
  };
  globalThis.api = {
    getPendingKnowledgeUploadTransfer: async () => pending,
    reselectKnowledgeUploadSource: async () => {
      pending = null;
      return true;
    },
  } as never;
  const recovered = vi.fn();
  render(<WebUploadRecovery uploading={false} onRecovered={recovered} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reselect PDFs' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Interrupted PDF transfer' }),
    ).not.toBeInTheDocument(),
  );
  expect(recovered).toHaveBeenCalledOnce();
});

it.each(['returns false', 'throws'])(
  'retries the current pending batch after recovery %s with a replacement batch',
  async (failure) => {
    let pending: { batchId: string; files: { id: string; name: string; size: number }[] } | null = {
      batchId: 'original-batch',
      files: [{ id: 'file', name: 'Runbook.pdf', size: 12 }],
    };
    globalThis.api = {
      getPendingKnowledgeUploadTransfer: async () => pending,
      reselectKnowledgeUploadSource: async (batchId: string) => {
        if (batchId !== pending?.batchId) return false;
        if (batchId === 'original-batch') {
          pending = { ...pending, batchId: 'replacement-batch' };
          if (failure === 'throws') throw new Error('Connection interrupted');
          return false;
        }
        pending = null;
        return true;
      },
    } as never;
    const recovered = vi.fn();
    render(<WebUploadRecovery uploading={false} onRecovered={recovered} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reselect PDFs' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/select.*PDFs/i);
    expect(recovered).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reselect PDFs' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('region', { name: 'Interrupted PDF transfer' }),
      ).not.toBeInTheDocument(),
    );
    expect(recovered).toHaveBeenCalledOnce();
  },
);

it('discards the replacement staging batch after another interrupted recovery', async () => {
  let pending: { batchId: string; files: { id: string; name: string; size: number }[] } | null = {
    batchId: 'original-batch',
    files: [{ id: 'file', name: 'Runbook.pdf', size: 12 }],
  };
  globalThis.api = {
    getPendingKnowledgeUploadTransfer: async () => pending,
    discardPendingKnowledgeUploadTransfer: async (batchId: string) => {
      if (batchId !== pending?.batchId) return false;
      pending = null;
      return true;
    },
    reselectKnowledgeUploadSource: async () => {
      pending = { ...pending!, batchId: 'replacement-batch' };
      return false;
    },
  } as never;
  const recovered = vi.fn();
  render(<WebUploadRecovery uploading={false} onRecovered={recovered} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Reselect PDFs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/select.*PDFs/i);
  fireEvent.click(screen.getByRole('button', { name: 'Discard Transfer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm Discard' }));

  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Interrupted PDF transfer' }),
    ).not.toBeInTheDocument(),
  );
  expect(recovered).not.toHaveBeenCalled();
});

it('reports a failed transfer check when the bridge cannot reach the server', async () => {
  globalThis.api = {
    getPendingKnowledgeUploadTransfer: async () => {
      throw new Error('Relay Web request unavailable');
    },
  } as never;
  render(<WebUploadRecovery uploading={false} onRecovered={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not check/i);
});

it('shows nothing when the bridge stages no resumable transfers', async () => {
  globalThis.api = {} as never;
  render(<WebUploadRecovery uploading={false} onRecovered={vi.fn()} />);
  await act(async () => {});
  expect(
    screen.queryByRole('region', { name: 'Interrupted PDF transfer' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
