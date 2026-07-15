import { fireEvent, render, screen } from '@testing-library/react';
import { AnnotationType } from 'pdfjs-dist/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeResolvedLink } from '../knowledgeLinkResolver';
import {
  extractKnowledgeLinkItems,
  KnowledgeLinkLayer,
  type KnowledgeLinkItem,
} from '../KnowledgeLinkLayer';

vi.mock('pdfjs-dist/build/pdf.mjs', () => ({
  AnnotationType: { LINK: 2, FILEATTACHMENT: 17, WIDGET: 20 },
}));

function viewport(convertToViewportRectangle = vi.fn((rect: number[]) => rect)) {
  return { convertToViewportRectangle } as never;
}

function renderLayer(
  items: readonly KnowledgeLinkItem[],
  options: {
    viewport?: ReturnType<typeof viewport>;
    resolveUrl?: (url: string) => KnowledgeResolvedLink;
    onActivateResolvedLink?: (link: KnowledgeResolvedLink) => void;
    onActivateDestination?: (destination: string | unknown[]) => void;
  } = {},
) {
  const props = {
    items,
    viewport: options.viewport ?? viewport(),
    resolveUrl:
      options.resolveUrl ??
      (() => ({ kind: 'unavailable' as const, reason: 'unsupported' as const })),
    onActivateResolvedLink: options.onActivateResolvedLink ?? vi.fn(),
    onActivateDestination: options.onActivateDestination ?? vi.fn(),
  };

  return { ...render(<KnowledgeLinkLayer {...props} />), props };
}

describe('extractKnowledgeLinkItems', () => {
  it('retains only link annotations with a rectangle and a native or authored target', () => {
    const destination = ['chapter', { name: 'Fit' }];

    expect(
      extractKnowledgeLinkItems([
        { annotationType: AnnotationType.LINK, id: 'dest', rect: [1, 2, 3, 4], dest: destination },
        {
          annotationType: AnnotationType.LINK,
          id: 'url',
          rect: [5, 6, 7, 8],
          url: 'https://relay.test/safe',
        },
        {
          subtype: 'Link',
          id: 'unsafe',
          rect: [9, 10, 11, 12],
          unsafeUrl: 'https://relay.test/authored value',
          url: 'https://relay.test/sanitized-value',
        },
        { annotationType: AnnotationType.LINK, id: 'missing', rect: [1, 2, 3, 4] },
      ]),
    ).toEqual([
      { id: 'dest', rect: [1, 2, 3, 4], action: { kind: 'destination', destination } },
      {
        id: 'url',
        rect: [5, 6, 7, 8],
        action: { kind: 'url', url: 'https://relay.test/safe' },
      },
      {
        id: 'unsafe',
        rect: [9, 10, 11, 12],
        action: { kind: 'url', url: 'https://relay.test/authored value' },
      },
    ]);
  });

  it('prefers a native destination when the annotation also carries a URL', () => {
    expect(
      extractKnowledgeLinkItems([
        {
          annotationType: AnnotationType.LINK,
          id: 'both',
          rect: [1, 2, 3, 4],
          dest: 'overview',
          unsafeUrl: 'https://relay.test',
        },
      ]),
    ).toEqual([
      {
        id: 'both',
        rect: [1, 2, 3, 4],
        action: { kind: 'destination', destination: 'overview' },
      },
    ]);
  });

  it('ignores retained named actions, attachments, forms, and malformed annotations', () => {
    expect(
      extractKnowledgeLinkItems([
        {
          annotationType: AnnotationType.LINK,
          id: 'named',
          rect: [1, 2, 3, 4],
          action: 'NextPage',
        },
        {
          annotationType: AnnotationType.FILEATTACHMENT,
          id: 'attachment',
          rect: [1, 2, 3, 4],
          unsafeUrl: 'Guide.pdf',
        },
        {
          annotationType: AnnotationType.WIDGET,
          id: 'form',
          rect: [1, 2, 3, 4],
          url: 'https://relay.test',
        },
        { annotationType: AnnotationType.LINK, id: 'short-rect', rect: [1, 2, 3], dest: 'target' },
        {
          annotationType: AnnotationType.LINK,
          id: 'nan-rect',
          rect: [1, 2, 3, Number.NaN],
          dest: 'target',
        },
        {
          annotationType: AnnotationType.LINK,
          id: 'x'.repeat(513),
          rect: [1, 2, 3, 4],
          dest: 'target',
        },
      ]),
    ).toEqual([]);
  });
});

describe('KnowledgeLinkLayer', () => {
  it('reinterprets a flattened HTTPS URL only through the resolver until activation', () => {
    const [item] = extractKnowledgeLinkItems([
      {
        annotationType: AnnotationType.LINK,
        id: 'flattened-web',
        rect: [0, 0, 10, 10],
        unsafeUrl: 'https://example.com/runbook',
      },
    ]);
    const resolvedLink: KnowledgeResolvedLink = {
      kind: 'web',
      url: 'https://example.com/runbook',
      hostname: 'example.com',
    };
    const resolveUrl = vi.fn(() => resolvedLink);
    const onActivateResolvedLink = vi.fn();

    renderLayer([item], { resolveUrl, onActivateResolvedLink });

    expect(resolveUrl).toHaveBeenCalledOnce();
    expect(resolveUrl).toHaveBeenCalledWith('https://example.com/runbook');
    expect(onActivateResolvedLink).not.toHaveBeenCalled();
    expect(document.querySelector('a')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(onActivateResolvedLink).toHaveBeenCalledOnce();
    expect(onActivateResolvedLink).toHaveBeenCalledWith(resolvedLink);
  });

  it('passes a flattened PDF path only to the Knowledge resolver until activation', () => {
    const flattenedPath = 'C:\\Author\\Runbooks\\Linked Guide.pdf';
    const [item] = extractKnowledgeLinkItems([
      {
        annotationType: AnnotationType.LINK,
        id: 'flattened-pdf',
        rect: [0, 0, 10, 10],
        unsafeUrl: flattenedPath,
      },
    ]);
    const resolvedLink: KnowledgeResolvedLink = {
      kind: 'knowledge-document',
      documentId: 'linked-guide',
      title: 'Linked Guide',
      pageIndex: 0,
    };
    const resolveUrl = vi.fn(() => resolvedLink);
    const onActivateResolvedLink = vi.fn();

    renderLayer([item], { resolveUrl, onActivateResolvedLink });

    expect(resolveUrl).toHaveBeenCalledOnce();
    expect(resolveUrl).toHaveBeenCalledWith(flattenedPath);
    expect(onActivateResolvedLink).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button'));
    expect(onActivateResolvedLink).toHaveBeenCalledOnce();
    expect(onActivateResolvedLink).toHaveBeenCalledWith(resolvedLink);
  });

  it('keeps a flattened javascript URL non-focusable and inert', () => {
    const [item] = extractKnowledgeLinkItems([
      {
        annotationType: AnnotationType.LINK,
        id: 'flattened-javascript',
        rect: [0, 0, 10, 10],
        unsafeUrl: 'javascript:alert(1)',
      },
    ]);
    const resolveUrl = vi.fn(
      (): KnowledgeResolvedLink => ({ kind: 'unavailable', reason: 'unsupported' }),
    );
    const onActivateResolvedLink = vi.fn();

    renderLayer([item], { resolveUrl, onActivateResolvedLink });

    expect(resolveUrl).toHaveBeenCalledWith('javascript:alert(1)');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onActivateResolvedLink).not.toHaveBeenCalled();
  });

  it('projects link rectangles through the viewport and normalizes reversed coordinates', () => {
    const convertToViewportRectangle = vi.fn(() => [90, 180, 10, 20]);
    renderLayer(
      [
        {
          id: 'destination',
          rect: [1, 2, 3, 4],
          action: { kind: 'destination', destination: 'target' },
        },
      ],
      { viewport: viewport(convertToViewportRectangle) },
    );

    expect(convertToViewportRectangle).toHaveBeenCalledWith([1, 2, 3, 4]);
    expect(screen.getByRole('button')).toHaveStyle({
      left: '10px',
      top: '20px',
      width: '80px',
      height: '160px',
    });
  });

  it('recomputes geometry when the viewport changes', () => {
    const item: KnowledgeLinkItem = {
      id: 'destination',
      rect: [1, 2, 3, 4],
      action: { kind: 'destination', destination: 'target' },
    };
    const firstViewport = viewport(vi.fn(() => [10, 20, 30, 40]));
    const secondViewport = viewport(vi.fn(() => [20, 40, 60, 80]));
    const { rerender, props } = renderLayer([item], { viewport: firstViewport });

    expect(screen.getByRole('button')).toHaveStyle({ left: '10px', width: '20px' });
    rerender(<KnowledgeLinkLayer {...props} viewport={secondViewport} />);
    expect(screen.getByRole('button')).toHaveStyle({ left: '20px', width: '40px' });
  });

  it('preserves annotation order and exposes concise internal and browser labels', () => {
    const resolveUrl = vi.fn((url: string): KnowledgeResolvedLink => {
      if (url === 'guide.pdf') {
        return {
          kind: 'knowledge-document',
          documentId: 'guide',
          title: 'Safety guide',
          pageIndex: 2,
        };
      }
      if (url === 'https://example.com/runbook') {
        return { kind: 'web', url, hostname: 'example.com' };
      }
      if (url === 'missing.pdf') return { kind: 'unavailable', reason: 'not-found' };
      if (url === 'ambiguous.pdf') return { kind: 'unavailable', reason: 'ambiguous' };
      return { kind: 'unavailable', reason: 'unsupported' };
    });
    renderLayer(
      [
        {
          id: 'web',
          rect: [0, 0, 10, 10],
          action: { kind: 'url', url: 'https://example.com/runbook' },
        },
        {
          id: 'native',
          rect: [0, 10, 10, 20],
          action: { kind: 'destination', destination: 'section' },
        },
        { id: 'guide', rect: [0, 20, 10, 30], action: { kind: 'url', url: 'guide.pdf' } },
        { id: 'missing', rect: [0, 30, 10, 40], action: { kind: 'url', url: 'missing.pdf' } },
        {
          id: 'unsupported',
          rect: [0, 40, 10, 50],
          action: { kind: 'url', url: 'javascript:alert(1)' },
        },
        { id: 'ambiguous', rect: [0, 50, 10, 60], action: { kind: 'url', url: 'ambiguous.pdf' } },
      ],
      { resolveUrl },
    );

    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Open example.com in browser',
      'Open linked location in this guide',
      'Open Safety guide, page 3',
      'Open linked guide',
      'Open linked guide',
    ]);
    expect(screen.queryByText('javascript:alert(1)')).not.toBeInTheDocument();
    expect(document.querySelector('a')).not.toBeInTheDocument();
  });

  it('uses native button semantics for destination and resolved targets', () => {
    const onActivateDestination = vi.fn();
    const onActivateResolvedLink = vi.fn();
    const resolvedLink: KnowledgeResolvedLink = {
      kind: 'web',
      url: 'https://example.com',
      hostname: 'example.com',
    };
    renderLayer(
      [
        {
          id: 'native',
          rect: [0, 0, 10, 10],
          action: { kind: 'destination', destination: 'section' },
        },
        { id: 'web', rect: [0, 10, 10, 20], action: { kind: 'url', url: resolvedLink.url } },
      ],
      {
        resolveUrl: () => resolvedLink,
        onActivateDestination,
        onActivateResolvedLink,
      },
    );
    const [destinationButton, webButton] = screen.getAllByRole('button');

    expect(destinationButton).toBeInstanceOf(HTMLButtonElement);
    expect(webButton).toBeInstanceOf(HTMLButtonElement);
    expect((destinationButton as HTMLButtonElement).type).toBe('button');
    expect((webButton as HTMLButtonElement).type).toBe('button');
    fireEvent.click(destinationButton);
    fireEvent.click(webButton);

    expect(onActivateDestination).toHaveBeenNthCalledWith(1, 'section');
    expect(onActivateDestination).toHaveBeenCalledOnce();
    expect(onActivateResolvedLink).toHaveBeenNthCalledWith(1, resolvedLink);
    expect(onActivateResolvedLink).toHaveBeenCalledOnce();
  });

  it('keeps missing and ambiguous PDF targets activatable while omitting unsupported targets', () => {
    const onActivateResolvedLink = vi.fn();
    const missing: KnowledgeResolvedLink = { kind: 'unavailable', reason: 'not-found' };
    const ambiguous: KnowledgeResolvedLink = { kind: 'unavailable', reason: 'ambiguous' };
    const unsupported: KnowledgeResolvedLink = { kind: 'unavailable', reason: 'unsupported' };
    renderLayer(
      [
        { id: 'missing', rect: [0, 0, 10, 10], action: { kind: 'url', url: 'missing.pdf' } },
        { id: 'unsupported', rect: [0, 10, 10, 20], action: { kind: 'url', url: 'blocked.exe' } },
        { id: 'ambiguous', rect: [0, 20, 10, 30], action: { kind: 'url', url: 'ambiguous.pdf' } },
      ],
      {
        resolveUrl: (url) =>
          ({ 'missing.pdf': missing, 'blocked.exe': unsupported, 'ambiguous.pdf': ambiguous })[url],
        onActivateResolvedLink,
      },
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    expect(onActivateResolvedLink).toHaveBeenNthCalledWith(1, missing);
    expect(onActivateResolvedLink).toHaveBeenNthCalledWith(2, ambiguous);
  });
});
