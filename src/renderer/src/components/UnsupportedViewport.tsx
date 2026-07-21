import { useEffect, useRef, useState, type PropsWithChildren, type ReactElement } from 'react';
import { getRelayRuntime } from '../runtime/relayRuntime';

const MINIMUM_WEB_WIDTH = 1024;

export function UnsupportedViewport({ children }: Readonly<PropsWithChildren>): ReactElement {
  const isWeb = getRelayRuntime().kind === 'web';
  const [supported, setSupported] = useState(
    () => !isWeb || globalThis.innerWidth >= MINIMUM_WEB_WIDTH,
  );
  const stateRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isWeb) return;
    const update = () => setSupported(globalThis.innerWidth >= MINIMUM_WEB_WIDTH);
    globalThis.addEventListener('resize', update);
    return () => globalThis.removeEventListener('resize', update);
  }, [isWeb]);

  useEffect(() => {
    if (!supported) stateRef.current?.focus();
  }, [supported]);

  if (supported) return <>{children}</>;
  return (
    <main
      ref={stateRef}
      className="unsupported-viewport"
      aria-label="Larger window required"
      tabIndex={-1}
    >
      <div className="unsupported-viewport__mark" aria-hidden="true">
        R
      </div>
      <h1>Larger window required</h1>
      <p>Relay Web needs a desktop browser window at least 1024 pixels wide.</p>
    </main>
  );
}
