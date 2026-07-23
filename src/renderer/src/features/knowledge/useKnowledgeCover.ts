import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

type CoverState = 'idle' | 'loading' | 'ready' | 'error';

export function useKnowledgeCover(request: { documentId: string; checksum: string }): {
  ref: (node: HTMLDivElement | null) => void;
  url: string | null;
  state: CoverState;
  aspectRatio: string | null;
  onImageLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onImageError: () => void;
} {
  const { documentId, checksum } = request;
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<CoverState>('idle');
  const [aspectRatio, setAspectRatio] = useState<string | null>(null);
  const ref = useCallback((next: HTMLDivElement | null) => setNode(next), []);
  const onImageLoad = useCallback((event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    setAspectRatio(
      Number.isFinite(naturalWidth) &&
        Number.isFinite(naturalHeight) &&
        naturalWidth > 0 &&
        naturalHeight > 0
        ? `${naturalWidth} / ${naturalHeight}`
        : null,
    );
    setState('ready');
  }, []);
  const onImageError = useCallback(() => {
    setAspectRatio(null);
    setState('error');
  }, []);

  useEffect(() => {
    if (!node || visible) return;
    if (!globalThis.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, visible]);

  useEffect(() => {
    if (!visible) return;
    const getKnowledgeCover = globalThis.api?.getKnowledgeCover;
    setUrl(null);
    setAspectRatio(null);
    setState('loading');
    if (!getKnowledgeCover) {
      setState('error');
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    void getKnowledgeCover({ documentId, checksum })
      .then((result) => {
        if (disposed) return;
        if (!result?.ok) {
          setState('error');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([result.data], { type: 'image/png' }));
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [checksum, documentId, visible]);

  return { ref, url, state, aspectRatio, onImageLoad, onImageError };
}
