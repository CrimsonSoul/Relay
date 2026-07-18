import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export type ContinuousPdfPageVisibility = {
  currentPageIndex: number;
  renderPageIndices: ReadonlySet<number>;
  registerPage: (pageIndex: number) => (node: HTMLElement | null) => void;
  scrollToPage: (pageIndex: number, top?: number | null) => void;
};

type ContinuousPdfPageOptions = {
  active: boolean;
  pageCount: number;
  rootRef: RefObject<HTMLDivElement | null>;
  initialPageIndex: number;
  overscanPages?: number;
  reducedMotion: boolean;
};

type VisibilityState = Pick<ContinuousPdfPageVisibility, 'currentPageIndex' | 'renderPageIndices'>;

const DEFAULT_OVERSCAN_PAGES = 2;
const OBSERVER_THRESHOLDS = [0, 0.01, 0.25, 0.5, 0.75, 1];

function boundedPageCount(pageCount: number): number {
  return Number.isFinite(pageCount) ? Math.max(0, Math.floor(pageCount)) : 0;
}

function boundedOverscan(overscanPages: number | undefined): number {
  const value = overscanPages ?? DEFAULT_OVERSCAN_PAGES;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : DEFAULT_OVERSCAN_PAGES;
}

function clampPageIndex(pageIndex: number, pageCount: number): number {
  if (pageCount === 0) return 0;
  return Math.min(Math.max(0, Math.floor(pageIndex)), pageCount - 1);
}

function pageRange(
  pageIndex: number,
  pageCount: number,
  overscanPages: number,
): ReadonlySet<number> {
  const indices = new Set<number>();
  const first = Math.max(0, pageIndex - overscanPages);
  const last = Math.min(pageCount - 1, pageIndex + overscanPages);
  for (let index = first; index <= last; index += 1) indices.add(index);
  return indices;
}

function equalPageRanges(left: ReadonlySet<number>, right: ReadonlySet<number>): boolean {
  if (left.size !== right.size) return false;
  for (const pageIndex of left) {
    if (!right.has(pageIndex)) return false;
  }
  return true;
}

export function useContinuousPdfPages({
  active,
  pageCount: pageCountOption,
  rootRef,
  initialPageIndex,
  overscanPages: overscanOption,
  reducedMotion,
}: ContinuousPdfPageOptions): ContinuousPdfPageVisibility {
  const pageCount = boundedPageCount(pageCountOption);
  const overscanPages = boundedOverscan(overscanOption);
  const pageCountRef = useRef(pageCount);
  const reducedMotionRef = useRef(reducedMotion);
  const pageShellsRef = useRef(new Map<number, HTMLElement>());
  const pageRefCallbacksRef = useRef(new Map<number, (node: HTMLElement | null) => void>());
  const pageIndexByShellRef = useRef(new WeakMap<Element, number>());
  const intersectionRatiosRef = useRef(new Map<number, number>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [visibility, setVisibility] = useState<VisibilityState>(() => {
    const initialPage = clampPageIndex(initialPageIndex, pageCount);
    return {
      currentPageIndex: initialPage,
      renderPageIndices: active ? pageRange(initialPage, pageCount, overscanPages) : new Set(),
    };
  });
  const visibilityRef = useRef(visibility);
  const currentPageIndexRef = useRef(visibility.currentPageIndex);

  pageCountRef.current = pageCount;
  reducedMotionRef.current = reducedMotion;
  visibilityRef.current = visibility;
  currentPageIndexRef.current = visibility.currentPageIndex;

  const registerPage = useCallback((pageIndex: number) => {
    const cachedCallback = pageRefCallbacksRef.current.get(pageIndex);
    if (cachedCallback) return cachedCallback;

    const pageRefCallback = (node: HTMLElement | null) => {
      if (node && (pageIndex < 0 || pageIndex >= pageCountRef.current)) return;

      const pageShells = pageShellsRef.current;
      const previousNode = pageShells.get(pageIndex);
      if (previousNode && previousNode === node) return;

      const observer = observerRef.current;
      if (previousNode) {
        observer?.unobserve(previousNode);
        pageIndexByShellRef.current.delete(previousNode);
      }
      intersectionRatiosRef.current.delete(pageIndex);

      if (node) {
        pageShells.set(pageIndex, node);
        pageIndexByShellRef.current.set(node, pageIndex);
        observer?.observe(node);
      } else {
        pageShells.delete(pageIndex);
        pageRefCallbacksRef.current.delete(pageIndex);
      }
    };

    pageRefCallbacksRef.current.set(pageIndex, pageRefCallback);
    return pageRefCallback;
  }, []);

  const scrollToPage = useCallback(
    (pageIndex: number, top?: number | null) => {
      if (pageIndex < 0 || pageIndex >= pageCountRef.current) return;
      const pageShell = pageShellsRef.current.get(pageIndex);
      const root = rootRef.current;
      if (!pageShell || !root) return;

      const targetOffset = top ?? 0;
      root.scrollTo({
        top: Math.max(0, pageShell.offsetTop + targetOffset - 28),
        behavior: reducedMotionRef.current ? 'auto' : 'smooth',
      });
    },
    [rootRef],
  );

  useEffect(() => {
    intersectionRatiosRef.current.clear();
    observerRef.current?.disconnect();
    observerRef.current = null;

    const updateVisibility = (nextCurrentPageIndex: number) => {
      const currentPageIndex = clampPageIndex(nextCurrentPageIndex, pageCount);
      const renderPageIndices = active
        ? pageRange(currentPageIndex, pageCount, overscanPages)
        : new Set<number>();
      const previous = visibilityRef.current;
      if (
        previous.currentPageIndex === currentPageIndex &&
        equalPageRanges(previous.renderPageIndices, renderPageIndices)
      ) {
        return;
      }
      const nextVisibility = { currentPageIndex, renderPageIndices };
      visibilityRef.current = nextVisibility;
      setVisibility(nextVisibility);
    };

    const root = rootRef.current;
    if (!active || pageCount === 0 || !root) {
      updateVisibility(currentPageIndexRef.current);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (observerRef.current !== observer) return;

        for (const entry of entries) {
          const pageIndex = pageIndexByShellRef.current.get(entry.target);
          if (pageIndex === undefined || pageIndex >= pageCountRef.current) continue;
          intersectionRatiosRef.current.set(
            pageIndex,
            entry.isIntersecting ? entry.intersectionRatio : 0,
          );
        }

        let nextCurrentPageIndex: number | null = null;
        let greatestRatio = 0;
        for (const [pageIndex, intersectionRatio] of intersectionRatiosRef.current) {
          if (
            intersectionRatio > greatestRatio ||
            (intersectionRatio === greatestRatio &&
              intersectionRatio > 0 &&
              (nextCurrentPageIndex === null || pageIndex < nextCurrentPageIndex))
          ) {
            greatestRatio = intersectionRatio;
            nextCurrentPageIndex = pageIndex;
          }
        }

        if (nextCurrentPageIndex !== null) updateVisibility(nextCurrentPageIndex);
      },
      {
        root,
        threshold: OBSERVER_THRESHOLDS,
      },
    );

    observerRef.current = observer;
    for (const [pageIndex, pageShell] of pageShellsRef.current) {
      if (pageIndex < pageCount) observer.observe(pageShell);
    }
    updateVisibility(currentPageIndexRef.current);

    return () => {
      if (observerRef.current === observer) observerRef.current = null;
      observer.disconnect();
    };
  }, [active, overscanPages, pageCount, rootRef]);

  return { ...visibility, registerPage, scrollToPage };
}
