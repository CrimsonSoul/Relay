import { useCallback, useEffect, useState } from 'react';

/**
 * Tracks whether an ellipsized element's text overflows its box. A Tooltip trigger that only
 * repeats visible text uses this to become a focus stop only while the text is cut off, so
 * keyboard users get the full text without a dead tab stop on every untruncated row.
 * Returns a callback ref for the element and the current overflow state.
 */
export function useIsTruncated<T extends HTMLElement>(
  text: string,
): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    if (!node) return undefined;
    const measure = () => setTruncated(node.scrollWidth > node.clientWidth);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => observer?.disconnect();
  }, [node, text]);

  const ref = useCallback((next: T | null) => setNode(next), []);
  return [ref, truncated];
}
