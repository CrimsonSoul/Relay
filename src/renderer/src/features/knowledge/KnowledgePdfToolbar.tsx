import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const MIN_SCALE = 0.6;
const MAX_SCALE = 2.4;

type KnowledgePdfToolbarProps = {
  identityKey?: string;
  category: string;
  title: string;
  currentSection?: string | null;
  toolbarLeading?: ReactNode;
  pageIndex: number;
  pageCount: number | null;
  scale: number;
  viewMode: 'continuous' | 'single';
  downloadState: 'idle' | 'downloading' | 'success' | 'error';
  onPreviousPage: () => void;
  onNextPage: () => void;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFitWidth: () => void;
  onSelectViewMode: (mode: 'continuous' | 'single') => void;
  onDownload: () => void;
};

export function KnowledgePdfToolbar({
  identityKey,
  category,
  title,
  currentSection,
  toolbarLeading,
  pageIndex,
  pageCount,
  scale,
  viewMode,
  downloadState,
  onPreviousPage,
  onNextPage,
  onZoomOut,
  onZoomIn,
  onFitWidth,
  onSelectViewMode,
  onDownload,
}: Readonly<KnowledgePdfToolbarProps>) {
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const viewOptionsRef = useRef<HTMLDivElement>(null);
  const viewOptionsButtonRef = useRef<HTMLButtonElement>(null);

  const closeViewOptions = useCallback((restoreFocus = false) => {
    setViewOptionsOpen(false);
    if (restoreFocus) queueMicrotask(() => viewOptionsButtonRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!viewOptionsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && viewOptionsRef.current?.contains(event.target)) return;
      closeViewOptions();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeViewOptions(true);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeViewOptions, viewOptionsOpen]);

  useEffect(() => setViewOptionsOpen(false), [identityKey]);

  const selectViewMode = (nextMode: 'continuous' | 'single') => {
    if (nextMode !== viewMode) onSelectViewMode(nextMode);
    closeViewOptions(true);
  };

  const fitWidth = () => {
    onFitWidth();
    closeViewOptions(true);
  };

  return (
    <header className="knowledge-viewer__toolbar">
      {toolbarLeading && <div className="knowledge-viewer__leading">{toolbarLeading}</div>}
      <div className="knowledge-viewer__heading">
        <div className="knowledge-viewer__identity">
          <span className="knowledge-viewer__eyebrow">{category}</span>
          <h1>{title}</h1>
          <span className="knowledge-viewer__section">
            {currentSection ? `Current section · ${currentSection}` : 'Document overview'}
          </span>
        </div>
      </div>
      <div className="knowledge-viewer__controls" aria-label="PDF controls">
        <fieldset
          className="knowledge-viewer__control-group knowledge-viewer__page-controls"
          aria-label="Page navigation"
        >
          <button
            type="button"
            aria-label="Previous page"
            disabled={pageCount === null || pageIndex === 0}
            onClick={onPreviousPage}
          >
            ←
          </button>
          <span className="knowledge-viewer__page-status" aria-live="polite" aria-atomic="true">
            <span className="knowledge-viewer__page-status-long" aria-hidden="true">
              {pageCount === null ? 'Loading document' : `Page ${pageIndex + 1} of ${pageCount}`}
            </span>
            <span className="knowledge-viewer__page-status-compact" aria-hidden="true">
              {pageCount === null ? 'Loading…' : `${pageIndex + 1} / ${pageCount}`}
            </span>
            <span className="sr-only">
              {pageCount === null
                ? 'Loading current document'
                : `Current page ${pageIndex + 1} of ${pageCount}`}
            </span>
          </span>
          <button
            type="button"
            aria-label="Next page"
            disabled={pageCount === null || pageIndex >= pageCount - 1}
            onClick={onNextPage}
          >
            →
          </button>
        </fieldset>
        <fieldset
          className="knowledge-viewer__control-group knowledge-viewer__zoom-controls"
          aria-label="Zoom controls"
        >
          <button
            type="button"
            aria-label="Zoom out"
            disabled={pageCount === null || scale <= MIN_SCALE}
            onClick={onZoomOut}
          >
            −
          </button>
          <span className="knowledge-viewer__zoom">{Math.round(scale * 100)}%</span>
          <button
            type="button"
            aria-label="Zoom in"
            disabled={pageCount === null || scale >= MAX_SCALE}
            onClick={onZoomIn}
          >
            +
          </button>
        </fieldset>
        <button
          type="button"
          className="knowledge-viewer__download"
          aria-label="Download PDF"
          title="Download PDF"
          data-state={downloadState}
          disabled={downloadState === 'downloading'}
          onClick={onDownload}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17">
            <path d="M12 3v11" />
            <path d="m7.5 10 4.5 4.5 4.5-4.5" />
            <path d="M5 20h14" />
          </svg>
          <span>{downloadState === 'downloading' ? 'Downloading…' : 'Download'}</span>
        </button>
        <div ref={viewOptionsRef} className="knowledge-viewer__view-menu">
          <button
            ref={viewOptionsButtonRef}
            type="button"
            className="knowledge-viewer__view-trigger"
            aria-label={`View options: ${viewMode === 'continuous' ? 'Continuous' : 'Single page'}`}
            aria-haspopup="dialog"
            aria-expanded={viewOptionsOpen}
            aria-controls="knowledge-view-options"
            onClick={() => setViewOptionsOpen((current) => !current)}
          >
            <span>View</span>
            <span aria-hidden="true">▾</span>
          </button>
          {viewOptionsOpen && (
            <dialog
              id="knowledge-view-options"
              className="knowledge-viewer__view-panel"
              open
              aria-label="View options"
              data-motion="popover"
            >
              <div className="knowledge-viewer__view-heading">View options</div>
              <button
                type="button"
                className="knowledge-viewer__view-option"
                disabled={pageCount === null}
                onClick={fitWidth}
              >
                <span>Fit width</span>
              </button>
              <span className="knowledge-viewer__view-label">Page flow</span>
              <button
                type="button"
                className="knowledge-viewer__view-option"
                aria-pressed={viewMode === 'continuous'}
                onClick={() => selectViewMode('continuous')}
              >
                <span>Continuous scrolling</span>
                <span aria-hidden="true">{viewMode === 'continuous' ? '✓' : ''}</span>
              </button>
              <button
                type="button"
                className="knowledge-viewer__view-option"
                aria-pressed={viewMode === 'single'}
                onClick={() => selectViewMode('single')}
              >
                <span>Single page</span>
                <span aria-hidden="true">{viewMode === 'single' ? '✓' : ''}</span>
              </button>
            </dialog>
          )}
        </div>
      </div>
    </header>
  );
}
