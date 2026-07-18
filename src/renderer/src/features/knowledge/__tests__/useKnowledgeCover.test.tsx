import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeCover } from '../useKnowledgeCover';

function Harness() {
  const cover = useKnowledgeCover({ documentId: 'document1', checksum: 'a'.repeat(64) });
  return (
    <div ref={cover.ref}>
      <span>{cover.state}</span>
      <span>{cover.url ?? 'no-url'}</span>
    </div>
  );
}

describe('useKnowledgeCover', () => {
  beforeEach(() => {
    globalThis.api = {
      getKnowledgeCover: vi.fn(async () => ({
        ok: true,
        data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer,
        checksum: 'a'.repeat(64),
        source: 'cache',
      })),
    } as never;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete globalThis.api;
    vi.restoreAllMocks();
  });

  it('requests visible cover bytes and revokes its object URL on unmount', async () => {
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument());
    expect(screen.getByText('blob:cover')).toBeInTheDocument();
    expect(globalThis.api?.getKnowledgeCover).toHaveBeenCalledWith({
      documentId: 'document1',
      checksum: 'a'.repeat(64),
    });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover');
  });
});
