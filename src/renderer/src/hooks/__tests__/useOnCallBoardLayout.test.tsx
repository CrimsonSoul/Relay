import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOnCallBoardLayout } from '../useOnCallBoardLayout';

/** Content grows with the scale; the grid shows `viewport` px before it would scroll. */
function Board({
  scale,
  viewport,
  width = 1200,
  onFit,
}: Readonly<{ scale: number; viewport: number; width?: number; onFit: (scale: number) => void }>) {
  const { boardStyle, gridRef, columnCount, fitToScreen } = useOnCallBoardLayout(scale, onFit);
  const setGrid = (node: HTMLUListElement | null) => {
    gridRef.current = node;
    if (!node) return;
    Object.defineProperty(node, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(node, 'clientHeight', { configurable: true, value: viewport });
    Object.defineProperty(node, 'scrollHeight', {
      configurable: true,
      // Fewer columns stack more rows, so height also rises as the scale drops the column count.
      get: () =>
        (Number(node.parentElement?.style.getPropertyValue('--oncall-font-scale')) * 1200) /
        Number(node.dataset.columns),
    });
  };
  return (
    <div style={boardStyle}>
      <ul ref={setGrid} data-columns={columnCount} />
      <button type="button" onClick={fitToScreen}>
        Fit
      </button>
    </div>
  );
}

describe('useOnCallBoardLayout fitToScreen', () => {
  it('commits the largest scale whose measured grid fits without scrolling', () => {
    const onFit = vi.fn();
    // 1200 px wide: 3 columns up to 105%, 2 columns from 110% (396+ px minimum column).
    render(<Board scale={100} viewport={700} onFit={onFit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    // 2 columns: 1200 * s / 2 <= 700 → s <= 1.1666, so 115% is the largest 5% step that fits.
    expect(onFit).toHaveBeenCalledTimes(1);
    expect(onFit).toHaveBeenCalledWith(115);
  });

  it('respects the maximum scale when the board has room to spare', () => {
    const onFit = vi.fn();
    render(<Board scale={100} viewport={5000} onFit={onFit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(onFit).toHaveBeenCalledWith(150);
  });

  it('settles on the minimum scale when nothing fits', () => {
    const onFit = vi.fn();
    render(<Board scale={100} viewport={10} onFit={onFit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(onFit).toHaveBeenCalledWith(85);
  });
});
