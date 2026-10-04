import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  clampOnCallFontScale,
  getOnCallBoardColumnMinWidth,
  ON_CALL_BOARD_GAP_PX,
  ON_CALL_FONT_SCALE_MAX,
  ON_CALL_FONT_SCALE_MIN,
  ON_CALL_FONT_SCALE_STEP,
} from '../theme/onCallDisplay';

function columnCountFor(width: number, scale: number): number {
  const minCol = getOnCallBoardColumnMinWidth(scale);
  return Math.max(1, Math.floor((width + ON_CALL_BOARD_GAP_PX) / (minCol + ON_CALL_BOARD_GAP_PX)));
}

/**
 * Font-scale styling and masonry column sizing for the on-call board, kept in
 * one place so the scale/column math stays consistent with the theme helpers
 * it wraps rather than being re-derived at the call site.
 *
 * `fitToScreen` measures the rendered grid at each scale from the largest down and commits the
 * largest one at which every team fits without scrolling. The trial renders run in layout effects,
 * so the wallboard never paints an intermediate scale; the result goes through `onFit`, the same
 * persisted setter the manual scale uses.
 */
export function useOnCallBoardLayout(onCallFontScale: number, onFit?: (scale: number) => void) {
  const [fitCandidate, setFitCandidate] = useState<number | null>(null);
  const effectiveOnCallFontScale = fitCandidate ?? clampOnCallFontScale(onCallFontScale);
  const boardStyle = useMemo(
    () =>
      ({
        '--oncall-font-scale': String(effectiveOnCallFontScale / 100),
      }) as React.CSSProperties,
    [effectiveOnCallFontScale],
  );

  const gridRef = useRef<HTMLUListElement | null>(null);
  const [columnCount, setColumnCount] = useState(3);

  const updateColumnCount = useCallback(() => {
    const node = gridRef.current;
    if (!node) return;
    const width = node.clientWidth;
    if (width < 1) return;
    const next = columnCountFor(width, effectiveOnCallFontScale);
    setColumnCount((prev) => (prev === next ? prev : next));
  }, [effectiveOnCallFontScale]);

  useEffect(() => {
    updateColumnCount();
    const node = gridRef.current;
    if (!node) return;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateColumnCount);
    observer?.observe(node);
    globalThis.addEventListener('resize', updateColumnCount);
    return () => {
      observer?.disconnect();
      globalThis.removeEventListener('resize', updateColumnCount);
    };
  }, [updateColumnCount]);

  useLayoutEffect(() => {
    if (fitCandidate === null) return;
    const node = gridRef.current;
    if (!node) {
      setFitCandidate(null);
      return;
    }
    // Lay the trial scale out with its own column count before measuring it.
    const width = node.clientWidth;
    const columnsForCandidate = width < 1 ? columnCount : columnCountFor(width, fitCandidate);
    if (columnsForCandidate !== columnCount) {
      setColumnCount(columnsForCandidate);
      return;
    }
    const fits = node.scrollHeight <= node.clientHeight + 1;
    if (fits || fitCandidate <= ON_CALL_FONT_SCALE_MIN) {
      onFit?.(fitCandidate);
      setFitCandidate(null);
      return;
    }
    setFitCandidate(fitCandidate - ON_CALL_FONT_SCALE_STEP);
  }, [fitCandidate, columnCount, onFit]);

  const fitToScreen = useCallback(() => setFitCandidate(ON_CALL_FONT_SCALE_MAX), []);

  return { effectiveOnCallFontScale, boardStyle, gridRef, columnCount, fitToScreen };
}
