import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WebUploadRecovery } from '../WebUploadRecovery';
afterEach(() => {
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
