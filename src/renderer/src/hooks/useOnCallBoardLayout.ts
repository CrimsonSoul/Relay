import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampOnCallFontScale,
  getOnCallBoardColumnMinWidth,
  ON_CALL_BOARD_GAP_PX,
} from '../theme/onCallDisplay';

/**
 * Shared font-scale styling and masonry column sizing for the on-call board.
 * PersonnelTab and PopoutBoard must render identically, so both consume this
 * hook instead of carrying their own copies of the scale/column math.
 */
export function useOnCallBoardLayout(onCallFontScale: number) {
  const effectiveOnCallFontScale = clampOnCallFontScale(onCallFontScale);
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
    const minCol = getOnCallBoardColumnMinWidth(effectiveOnCallFontScale);
    const next = Math.max(
      1,
      Math.floor((width + ON_CALL_BOARD_GAP_PX) / (minCol + ON_CALL_BOARD_GAP_PX)),
    );
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

  return { effectiveOnCallFontScale, boardStyle, gridRef, columnCount };
}
