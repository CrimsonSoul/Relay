import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeDocumentSearchMatch } from '../knowledgeDocumentSearch';
import { KnowledgeSearchHighlightLayer } from '../KnowledgeSearchHighlightLayer';

function textLayerWithSpans(values: string[]): HTMLDivElement {
  const layer = document.createElement('div');
  values.forEach((value, itemIndex) => {
    const span = document.createElement('span');
    span.textContent = value;
    span.dataset.knowledgeTextItemIndex = String(itemIndex);
    layer.append(span);
  });
  document.body.append(layer);
  vi.spyOn(layer, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 10, y: 20, width: 600, height: 800 }),
  );
  return layer;
}

function match(
  id: string,
  startItem: number,
  startOffset: number,
  endItem: number,
  endOffset: number,
): KnowledgeDocumentSearchMatch {
  return {
    id,
    pageIndex: 0,
    matchIndex: 0,
    snippet: id,
    sectionLabel: null,
    normalizedStart: 0,
    normalizedEnd: 5,
    textItemRange: { start: startItem, end: endItem },
    domRange: {
      start: { itemIndex: startItem, itemOffset: startOffset },
      end: { itemIndex: endItem, itemOffset: endOffset },
    },
  };
}

function installRangeMock() {
  const setStart = vi.fn();
  const setEnd = vi.fn();
  const getClientRects = vi.fn(() => [DOMRect.fromRect({ x: 30, y: 70, width: 120, height: 18 })]);
  vi.spyOn(document, 'createRange').mockReturnValue({
    setStart,
    setEnd,
    getClientRects,
  } as unknown as Range);
  return { setStart, setEnd, getClientRects };
}

describe('KnowledgeSearchHighlightLayer', () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('creates quiet rectangles for all matches and marks the active match', () => {
    installRangeMock();
    const onActiveHighlightReady = vi.fn();
    render(
      <KnowledgeSearchHighlightLayer
        textLayer={textLayerWithSpans(['Reset ', 'the lane', ' service'])}
        textLayerVersion={1}
        matches={[match('first', 0, 0, 1, 8), match('second', 2, 0, 2, 7)]}
        activeResultId="second"
        onActiveHighlightReady={onActiveHighlightReady}
      />,
    );

    expect(screen.getAllByTestId('knowledge-search-highlight')).toHaveLength(1);
    expect(screen.getByTestId('knowledge-search-highlight-active')).toHaveAttribute(
      'data-result-id',
      'second',
    );
    expect(onActiveHighlightReady).toHaveBeenCalledWith('second', 50);
  });

  it('skips matches whose text spans are not rendered', () => {
    installRangeMock();
    render(
      <KnowledgeSearchHighlightLayer
        textLayer={textLayerWithSpans(['Reset'])}
        textLayerVersion={1}
        matches={[match('missing', 0, 0, 4, 7)]}
        activeResultId="missing"
      />,
    );

    expect(screen.queryByTestId('knowledge-search-highlight-active')).not.toBeInTheDocument();
  });

  it('uses source text-item indices when PDF.js omits an empty span', () => {
    const range = installRangeMock();
    const layer = textLayerWithSpans(['Intro', 'RF', 'gg']);
    const spans = layer.querySelectorAll('span');
    spans[1]!.dataset.knowledgeTextItemIndex = '2';
    spans[2]!.dataset.knowledgeTextItemIndex = '3';

    render(
      <KnowledgeSearchHighlightLayer
        textLayer={layer}
        textLayerVersion={1}
        matches={[match('rf-result', 2, 0, 2, 2)]}
        activeResultId="rf-result"
      />,
    );

    const rfNode = Array.from(layer.querySelectorAll('span')).find(
      (span) => span.textContent === 'RF',
    )?.firstChild;
    expect(range.setStart).toHaveBeenCalledWith(rfNode, 0);
    expect(range.setEnd).toHaveBeenCalledWith(rfNode, 2);
  });

  it('recomputes rectangles when the text-layer version changes', () => {
    const range = installRangeMock();
    const layer = textLayerWithSpans(['Reset']);
    const result = match('result', 0, 0, 0, 5);
    const { rerender } = render(
      <KnowledgeSearchHighlightLayer
        textLayer={layer}
        textLayerVersion={1}
        matches={[result]}
        activeResultId="result"
      />,
    );
    expect(range.getClientRects).toHaveBeenCalledOnce();

    rerender(
      <KnowledgeSearchHighlightLayer
        textLayer={layer}
        textLayerVersion={2}
        matches={[result]}
        activeResultId="result"
      />,
    );

    expect(range.getClientRects).toHaveBeenCalledTimes(2);
  });
});
