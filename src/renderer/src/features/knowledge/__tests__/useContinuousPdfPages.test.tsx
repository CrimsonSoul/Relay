import { useRef } from 'react';
import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useContinuousPdfPages } from '../useContinuousPdfPages';

type ObserverEntry = {
  target: Element;
  intersectionRatio: number;
  isIntersecting?: boolean;
};

class IntersectionObserverDouble {
  static readonly instances: IntersectionObserverDouble[] = [];

  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    IntersectionObserverDouble.instances.push(this);
  }

  emit(entries: ObserverEntry[]): void {
    this.callback(
      entries.map(
        ({ target, intersectionRatio, isIntersecting = intersectionRatio > 0 }) =>
          ({ target, intersectionRatio, isIntersecting }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

function createRoot(): HTMLDivElement {
  const root = document.createElement('div');
  root.scrollTo = vi.fn();
  document.body.append(root);
  return root;
}

describe('useContinuousPdfPages', () => {
  beforeEach(() => {
    IntersectionObserverDouble.instances.splice(0);
    vi.stubGlobal('IntersectionObserver', IntersectionObserverDouble);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  function renderPages(overrides: Partial<Parameters<typeof useContinuousPdfPages>[0]> = {}) {
    const root = createRoot();
    const rootRef = { current: root };
    const hook = renderHook((options) => useContinuousPdfPages(options), {
      initialProps: {
        active: true,
        pageCount: 8,
        rootRef,
        initialPageIndex: 0,
        reducedMotion: false,
        ...overrides,
      },
    });
    return { ...hook, root, rootRef };
  }

  function firstObserver(): IntersectionObserverDouble {
    const [observer] = IntersectionObserverDouble.instances;
    if (!observer) throw new Error('No IntersectionObserver was constructed');
    return observer;
  }

  function registerPages(
    registerPage: (pageIndex: number) => (node: HTMLElement | null) => void,
    count: number,
  ): (pageIndex: number) => HTMLDivElement {
    const pages = Array.from({ length: count }, (_, pageIndex) => {
      const page = document.createElement('div');
      registerPage(pageIndex)(page);
      return page;
    });
    return (pageIndex) => {
      const page = pages[pageIndex];
      if (!page) throw new Error(`Page ${pageIndex} was never registered`);
      return page;
    };
  }

  it('uses the greatest intersection ratio as the current page and renders bounded overscan', () => {
    const { result } = renderPages();
    const pageAt = registerPages(result.current.registerPage, 8);

    act(() => {
      firstObserver().emit([
        { target: pageAt(0), intersectionRatio: 0.25 },
        { target: pageAt(1), intersectionRatio: 0.8 },
        { target: pageAt(2), intersectionRatio: 0.4 },
      ]);
    });

    expect(result.current.currentPageIndex).toBe(1);
    expect([...result.current.renderPageIndices]).toEqual([0, 1, 2, 3]);
    expect(result.current.renderPageIndices.size).toBeLessThanOrEqual(5);
  });

  it('uses dense intersection thresholds so clipped pages advance the render window', () => {
    renderPages();

    expect(firstObserver().options?.threshold).toEqual(
      Array.from({ length: 101 }, (_, index) => index / 100),
    );
  });

  it('chooses the smaller page index when intersection ratios are equal', () => {
    const { result } = renderPages({ initialPageIndex: 4 });
    const pageAt = registerPages(result.current.registerPage, 8);

    act(() => {
      firstObserver().emit([
        { target: pageAt(5), intersectionRatio: 0.6 },
        { target: pageAt(3), intersectionRatio: 0.6 },
      ]);
    });

    expect(result.current.currentPageIndex).toBe(3);
  });

  it('clamps the overscan range at the first and last pages', () => {
    const { result } = renderPages({ pageCount: 4 });
    const pageAt = registerPages(result.current.registerPage, 4);

    act(() => {
      firstObserver().emit([{ target: pageAt(0), intersectionRatio: 1 }]);
    });
    expect([...result.current.renderPageIndices]).toEqual([0, 1, 2]);

    act(() => {
      firstObserver().emit([
        { target: pageAt(0), intersectionRatio: 0 },
        { target: pageAt(3), intersectionRatio: 1 },
      ]);
    });
    expect([...result.current.renderPageIndices]).toEqual([1, 2, 3]);
  });

  it('disconnects the viewer-rooted observer while inactive and ignores its later entries', () => {
    const { result, rerender, rootRef } = renderPages();
    const pageAt = registerPages(result.current.registerPage, 8);
    const observer = firstObserver();

    rerender({
      active: false,
      pageCount: 8,
      rootRef,
      initialPageIndex: 0,
      reducedMotion: false,
    });
    expect(observer.disconnect).toHaveBeenCalledOnce();

    act(() => observer.emit([{ target: pageAt(4), intersectionRatio: 1 }]));
    expect(result.current.currentPageIndex).toBe(0);
    expect([...result.current.renderPageIndices]).toEqual([]);
  });

  it('scrolls the registered page shell inside the viewer using its scaled target offset', () => {
    const { result, root } = renderPages({ reducedMotion: true });
    const pageAt = registerPages(result.current.registerPage, 3);
    Object.defineProperty(pageAt(1), 'offsetTop', { configurable: true, value: 200 });

    act(() => result.current.scrollToPage(1, 80));

    expect(root.scrollTo).toHaveBeenCalledWith({ top: 252, behavior: 'auto' });
  });

  it('keeps existing page refs observed across unrelated shell rerenders', () => {
    function PageHarness({ scale }: Readonly<{ scale: number }>) {
      const rootRef = useRef<HTMLDivElement>(null);
      const { registerPage } = useContinuousPdfPages({
        active: true,
        pageCount: 3,
        rootRef,
        initialPageIndex: 0,
        reducedMotion: true,
      });
      return (
        <div ref={rootRef} data-scale={scale}>
          {[0, 1, 2].map((pageIndex) => (
            <div key={pageIndex} ref={registerPage(pageIndex)} data-page-index={pageIndex} />
          ))}
        </div>
      );
    }

    const { rerender } = render(<PageHarness scale={1} />);
    const observer = firstObserver();
    expect(observer.observe).toHaveBeenCalledTimes(3);

    rerender(<PageHarness scale={1.25} />);

    expect(observer.unobserve).not.toHaveBeenCalled();
    expect(observer.observe).toHaveBeenCalledTimes(3);
  });
});
