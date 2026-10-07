import { useEffect, useRef, useState } from 'react';
import { SDP_INLINE_IMAGE_BATCH, type SdpInlineImages } from '@shared/sdpAttachments';
import { sdpTicketUrl } from '@shared/sdpLinks';

type Done = (url: string | null) => void;
type Pending = { ticketId: string; path: string; sent: boolean; waiting: Set<Done> };

const LOADED_LIMIT = 80;
// Successful reads only; an image that failed is asked for again the next time it appears.
const loaded = new Map<string, string>();
const pending = new Map<string, Pending>();
let reading = false;

const keyOf = (ticketId: string, path: string) => `${ticketId}:${path}`;

function remember(key: string, url: string) {
  loaded.delete(key);
  loaded.set(key, url);
  while (loaded.size > LOADED_LIMIT) loaded.delete(loaded.keys().next().value!);
}

function settle(request: Pending, url: string | null) {
  const key = keyOf(request.ticketId, request.path);
  pending.delete(key);
  if (url) remember(key, url);
  request.waiting.forEach((done) => done(url));
}

/** One batch at a time keeps image reads well inside the SDP request budget. */
async function readNext(): Promise<void> {
  if (reading) return;
  const first = [...pending.values()].find((request) => !request.sent);
  if (!first) return;
  const batch = [...pending.values()]
    .filter((request) => !request.sent && request.ticketId === first.ticketId)
    .slice(0, SDP_INLINE_IMAGE_BATCH);
  batch.forEach((request) => (request.sent = true));
  reading = true;
  try {
    let result: SdpInlineImages | undefined;
    try {
      const reply = await globalThis.api?.sdpAccount?.({
        action: 'readInlineImages',
        id: first.ticketId,
        paths: batch.map((request) => request.path),
      });
      result = reply?.success ? reply.data?.inlineImages : undefined;
    } catch {
      result = undefined;
    }
    for (const request of batch) {
      const image = result?.images.find((item) => item.path === request.path);
      if (image) settle(request, `data:${image.contentType};base64,${image.data}`);
      else if (result?.deferred.includes(request.path)) request.sent = false;
      else settle(request, null);
    }
  } finally {
    reading = false;
  }
  void readNext();
}

function load(ticketId: string, path: string, done: Done): () => void {
  const key = keyOf(ticketId, path);
  let request = pending.get(key);
  if (!request) {
    request = { ticketId, path, sent: false, waiting: new Set() };
    pending.set(key, request);
  }
  const current = request;
  current.waiting.add(done);
  // Images that appear in the same render share one batch.
  queueMicrotask(() => void readNext());
  return () => {
    current.waiting.delete(done);
    if (!current.waiting.size && !current.sent) pending.delete(key);
  };
}

/**
 * An image SDP stored from an incoming email. It loads through the signed-in account once it is
 * near the visible area; one SDP cannot provide links to the ticket in SDP instead.
 */
export function SdpInlineImage({
  ticketId,
  path,
  alt,
  width,
  height,
}: Readonly<{ ticketId: string; path: string; alt: string; width?: number; height?: number }>) {
  const [url, setUrl] = useState(() => loaded.get(keyOf(ticketId, path)));
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  const holder = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const node = holder.current;
    if (url || near || !node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '400px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [url, near]);
  useEffect(() => {
    if (url || !near) return;
    return load(ticketId, path, (next) => (next ? setUrl(next) : setFailed(true)));
  }, [ticketId, path, url, near]);
  if (url)
    return <img className="sdp-live-image" src={url} alt={alt} width={width} height={height} />;
  if (failed)
    return (
      <button
        type="button"
        className="sdp-live-image-link"
        title="SDP could not provide this image"
        onClick={() => void globalThis.api?.openExternal(sdpTicketUrl(ticketId))}
      >
        {alt ? `Image: ${alt}` : 'Image'} · View in SDP
      </button>
    );
  return (
    <span
      ref={holder}
      className="sdp-live-image-pending"
      style={{ width: width && Math.min(width, 600), height: height && Math.min(height, 400) }}
    >
      <span className="sr-only">{alt ? `Loading image: ${alt}` : 'Loading image'}</span>
    </span>
  );
}
