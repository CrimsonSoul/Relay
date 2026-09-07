import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WEB_RUNTIME } from '@shared/runtime';
import { webSessionClient } from '../../../runtime/WebSessionClient';
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
  vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => pending }));
  globalThis.api = {
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
    vi.stubGlobal('fetch', async () => ({ ok: true, json: async () => pending }));
    globalThis.api = {
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
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url.endsWith('/pending')) return { ok: true, json: async () => pending };
    if (url.endsWith('/abort') && init?.body === JSON.stringify({ batchId: pending?.batchId })) {
      pending = null;
      return { ok: true };
    }
    return { ok: false };
  });
  vi.spyOn(webSessionClient, 'bootstrap').mockResolvedValue({
    ok: true,
    session: {
      csrfToken: 'c'.repeat(43),
      pbUrl: 'https://relay-server',
      auth: { token: 'app-user-token', record: null },
      publicConfig: { mode: 'server', port: 8090 },
      runtime: WEB_RUNTIME,
    },
  });
  globalThis.api = {
    reselectKnowledgeUploadSource: async () => {
      pending = { ...pending!, batchId: 'replacement-batch' };
      return false;
    },
  } as never;
  const recovered = vi.fn();
  render(<WebUploadRecovery uploading={false} onRecovered={recovered} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Reselect PDFs' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/select.*PDFs/i);
  fireEvent.click(screen.getByRole('button', { name: 'Discard transfer' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));

  await waitFor(() =>
    expect(
      screen.queryByRole('region', { name: 'Interrupted PDF transfer' }),
    ).not.toBeInTheDocument(),
  );
  expect(recovered).not.toHaveBeenCalled();
});
