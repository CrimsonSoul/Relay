import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKnowledgeCover } from '../useKnowledgeCover';

function Harness() {
  const cover = useKnowledgeCover({ documentId: 'document1', checksum: 'a'.repeat(64) });
  return (
    <div ref={cover.ref}>
      <span>{cover.state}</span>
      <span>{cover.url ?? 'no-url'}</span>
      {cover.url && (
        <img src={cover.url} alt="Cover" onLoad={cover.onImageLoad} onError={cover.onImageError} />
      )}
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
    vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete globalThis.api;
    vi.restoreAllMocks();
  });

  it('requests visible cover bytes and revokes its object URL on unmount', async () => {
    const view = render(<Harness />);
    await waitFor(() => expect(screen.getByText('blob:first')).toBeInTheDocument());
    expect(screen.getByText('loading')).toBeInTheDocument();
    fireEvent.load(screen.getByRole('img', { name: 'Cover' }));
    expect(screen.getByText('ready')).toBeInTheDocument();
    expect(globalThis.api?.getKnowledgeCover).toHaveBeenCalledWith({
      documentId: 'document1',
      checksum: 'a'.repeat(64),
    });
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });

  it('revokes the old object URL and returns to loading when checksum changes', async () => {
    const { result, rerender } = renderHook(
      ({ checksum }) => useKnowledgeCover({ documentId: 'guide', checksum }),
      { initialProps: { checksum: 'a'.repeat(64) } },
    );
    act(() => result.current.ref(document.createElement('div')));
    await waitFor(() => expect(result.current.url).toBe('blob:first'));

    rerender({ checksum: 'b'.repeat(64) });

    expect(result.current.state).toBe('loading');
    expect(result.current.url).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });

  it('does not report ready until the image decodes and falls back on image error', async () => {
    const { result } = renderHook(() =>
      useKnowledgeCover({ documentId: 'guide', checksum: 'a'.repeat(64) }),
    );
    act(() => result.current.ref(document.createElement('div')));
    await waitFor(() => expect(result.current.url).toBeTruthy());
    expect(result.current.state).toBe('loading');

    act(() => result.current.onImageLoad());
    expect(result.current.state).toBe('ready');

    act(() => result.current.onImageError());
    expect(result.current.state).toBe('error');
  });
});
