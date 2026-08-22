import { useLayoutEffect, useState, type CSSProperties } from 'react';
import type { KnowledgeDocumentSearchMatch } from './knowledgeDocumentSearch';

type SearchHighlightRectangle = {
  key: string;
  resultId: string;
  active: boolean;
  style: CSSProperties;
  top: number;
};

export type KnowledgeSearchHighlightLayerProps = {
  textLayer: HTMLDivElement | null;
  textLayerVersion: number;
  matches: readonly KnowledgeDocumentSearchMatch[];
  activeResultId?: string | null;
  onActiveHighlightReady?: (resultId: string, top: number) => void;
};

function clampOffset(node: Node, offset: number): number {
  return Math.max(0, Math.min(offset, node.textContent?.length ?? 0));
}

function rectanglesForMatch(
  match: KnowledgeDocumentSearchMatch,
  spansByTextItemIndex: ReadonlyMap<number, HTMLSpanElement>,
  layerBounds: DOMRect,
): SearchHighlightRectangle[] {
  const startNode = spansByTextItemIndex.get(match.domRange.start.itemIndex)?.firstChild;
  const endNode = spansByTextItemIndex.get(match.domRange.end.itemIndex)?.firstChild;
  if (!startNode || !endNode) return [];

  const range = document.createRange();
  range.setStart(startNode, clampOffset(startNode, match.domRange.start.itemOffset));
  range.setEnd(endNode, clampOffset(endNode, match.domRange.end.itemOffset));

  return Array.from(range.getClientRects())
    .filter((rectangle) => rectangle.width > 0 && rectangle.height > 0)
    .map((rectangle, rectangleIndex) => {
      const top = rectangle.top - layerBounds.top;
      return {
        key: `${match.id}:${rectangleIndex}`,
        resultId: match.id,
        active: false,
        top,
        style: {
          left: rectangle.left - layerBounds.left,
          top,
          width: rectangle.width,
          height: rectangle.height,
        },
      };
    });
}

export function KnowledgeSearchHighlightLayer({
  textLayer,
  textLayerVersion,
  matches,
  activeResultId = null,
  onActiveHighlightReady,
}: Readonly<KnowledgeSearchHighlightLayerProps>) {
  const [rectangles, setRectangles] = useState<SearchHighlightRectangle[]>([]);

  useLayoutEffect(() => {
    if (!textLayer || textLayerVersion <= 0 || matches.length === 0) {
      setRectangles([]);
      return;
    }

    const spansByTextItemIndex = new Map<number, HTMLSpanElement>();
    textLayer
      .querySelectorAll<HTMLSpanElement>('[data-knowledge-text-item-index]')
      .forEach((span) => {
        const itemIndex = Number(span.dataset.knowledgeTextItemIndex);
        if (Number.isInteger(itemIndex)) spansByTextItemIndex.set(itemIndex, span);
      });
    const layerBounds = textLayer.getBoundingClientRect();
    const nextRectangles = matches.flatMap((match) =>
      rectanglesForMatch(match, spansByTextItemIndex, layerBounds).map((rectangle) => ({
        ...rectangle,
        active: match.id === activeResultId,
      })),
    );
    setRectangles(nextRectangles);

    const activeRectangle = nextRectangles.find((rectangle) => rectangle.active);
    if (activeRectangle) onActiveHighlightReady?.(activeRectangle.resultId, activeRectangle.top);
  }, [activeResultId, matches, onActiveHighlightReady, textLayer, textLayerVersion]);

  if (rectangles.length === 0) return null;

  return (
    <div className="knowledge-page__search-layer" aria-hidden="true">
      {rectangles.map((rectangle) => (
        <span
          key={rectangle.key}
          className={`knowledge-search-highlight${rectangle.active ? ' is-active' : ''}`}
          data-result-id={rectangle.resultId}
          data-testid={
            rectangle.active ? 'knowledge-search-highlight-active' : 'knowledge-search-highlight'
          }
          style={rectangle.style}
        />
      ))}
    </div>
  );
}
