import { useCallback, useEffect, useState } from 'react';

type CoverState = 'idle' | 'loading' | 'ready' | 'error';

export function useKnowledgeCover(request: { documentId: string; checksum: string }): {
  ref: (node: HTMLDivElement | null) => void;
  url: string | null;
  state: CoverState;
} {
  const { documentId, checksum } = request;
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<CoverState>('idle');
  const ref = useCallback((next: HTMLDivElement | null) => setNode(next), []);

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
    if (!getKnowledgeCover) {
      setState('error');
      return;
    }
    let disposed = false;
    let objectUrl: string | null = null;
    setState('loading');
    void getKnowledgeCover({ documentId, checksum })
      .then((result) => {
        if (disposed) return;
        if (!result?.ok) {
          setState('error');
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([result.data], { type: 'image/png' }));
        setUrl(objectUrl);
        setState('ready');
      })
      .catch(() => {
        if (!disposed) setState('error');
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [checksum, documentId, visible]);

  return { ref, url, state };
}
