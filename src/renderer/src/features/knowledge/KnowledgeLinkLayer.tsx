import { AnnotationType, type PDFPageProxy } from 'pdfjs-dist/build/pdf.mjs';
import type { CSSProperties } from 'react';
import type { KnowledgeResolvedLink } from './knowledgeLinkResolver';

const MAX_ANNOTATION_ID_LENGTH = 512;

type PageViewport = ReturnType<PDFPageProxy['getViewport']>;

export type KnowledgePdfDestination = string | unknown[];

export type KnowledgeLinkItem = {
  id: string;
  rect: readonly [number, number, number, number];
  action:
    { kind: 'destination'; destination: KnowledgePdfDestination } | { kind: 'url'; url: string };
};

type KnowledgeLinkLayerProps = {
  items: readonly KnowledgeLinkItem[];
  viewport: PageViewport;
  resolveUrl: (url: string) => KnowledgeResolvedLink;
  onActivateResolvedLink: (link: KnowledgeResolvedLink) => void;
  onActivateDestination: (destination: KnowledgePdfDestination) => void;
};

type RenderableLink = {
  id: string;
  label: string;
  style: CSSProperties;
  activate: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDestination(value: unknown): value is KnowledgePdfDestination {
  return typeof value === 'string' || Array.isArray(value);
}

function finiteRectangle(value: unknown): readonly [number, number, number, number] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
  ) {
    return null;
  }

  return [value[0], value[1], value[2], value[3]];
}

function extractKnowledgeLinkItem(annotation: unknown): KnowledgeLinkItem | null {
  if (!isRecord(annotation)) return null;

  const isLink =
    annotation.annotationType === AnnotationType.LINK ||
    (annotation.annotationType == null && annotation.subtype === 'Link');
  if (!isLink) return null;
  if (annotation.action != null || annotation.jsActions != null) return null;
  if (
    typeof annotation.id !== 'string' ||
    annotation.id.length === 0 ||
    annotation.id.length > MAX_ANNOTATION_ID_LENGTH
  ) {
    return null;
  }

  const rect = finiteRectangle(annotation.rect);
  if (!rect) return null;

  if (isDestination(annotation.dest)) {
    return {
      id: annotation.id,
      rect,
      action: { kind: 'destination', destination: annotation.dest },
    };
  }

  const rawUrl = annotation.unsafeUrl ?? annotation.url;
  return typeof rawUrl === 'string'
    ? { id: annotation.id, rect, action: { kind: 'url', url: rawUrl } }
    : null;
}

export function extractKnowledgeLinkItems(annotations: readonly unknown[]): KnowledgeLinkItem[] {
  return annotations
    .map((annotation) => extractKnowledgeLinkItem(annotation))
    .filter((item): item is KnowledgeLinkItem => item !== null);
}

function resolvedLinkLabel(link: KnowledgeResolvedLink): string | null {
  switch (link.kind) {
    case 'same-document':
      return `Open this guide, page ${link.pageIndex + 1}`;
    case 'knowledge-document':
      return `Open ${link.title}, page ${link.pageIndex + 1}`;
    case 'web':
      return `Open ${link.hostname} in browser`;
    case 'unavailable':
      return link.reason === 'unsupported' ? null : 'Open linked guide';
  }
}

function projectedStyle(
  viewport: PageViewport,
  rect: readonly [number, number, number, number],
): CSSProperties | null {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const coordinates = finiteRectangle([x1, y1, x2, y2]);
  if (!coordinates) return null;

  const [projectedX1, projectedY1, projectedX2, projectedY2] = coordinates;
  const left = Math.min(projectedX1, projectedX2);
  const top = Math.min(projectedY1, projectedY2);

  return {
    left,
    top,
    width: Math.max(projectedX1, projectedX2) - left,
    height: Math.max(projectedY1, projectedY2) - top,
  };
}

export function KnowledgeLinkLayer({
  items,
  viewport,
  resolveUrl,
  onActivateResolvedLink,
  onActivateDestination,
}: Readonly<KnowledgeLinkLayerProps>) {
  const links: RenderableLink[] = [];

  for (const item of items) {
    const style = projectedStyle(viewport, item.rect);
    if (!style) continue;

    if (item.action.kind === 'destination') {
      links.push({
        id: item.id,
        label: 'Open linked location in this guide',
        style,
        activate: () => onActivateDestination(item.action.destination),
      });
      continue;
    }

    const resolvedLink = resolveUrl(item.action.url);
    const label = resolvedLinkLabel(resolvedLink);
    if (!label) continue;

    links.push({
      id: item.id,
      label,
      style,
      activate: () => onActivateResolvedLink(resolvedLink),
    });
  }

  return (
    <div className="knowledge-page__link-layer">
      {links.map((link) => (
        <button
          key={link.id}
          type="button"
          className="knowledge-page__link-target"
          style={link.style}
          aria-label={link.label}
          onClick={link.activate}
        />
      ))}
    </div>
  );
}
