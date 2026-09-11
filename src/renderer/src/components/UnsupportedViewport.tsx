import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from 'react';
import { createPortal } from 'react-dom';
import { getRelayRuntime } from '../runtime/relayRuntime';

const MINIMUM_WEB_WIDTH = 1024;

export function UnsupportedViewport({ children }: Readonly<PropsWithChildren>): ReactElement {
  const isWeb = getRelayRuntime().kind === 'web';
  const [supported, setSupported] = useState(
    () => !isWeb || globalThis.innerWidth >= MINIMUM_WEB_WIDTH,
  );
  const [hasMountedWorkspace, setHasMountedWorkspace] = useState(supported);
  const stateRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!isWeb) return;
    const update = () => {
      const nextSupported = globalThis.innerWidth >= MINIMUM_WEB_WIDTH;
      setSupported(nextSupported);
      if (nextSupported) setHasMountedWorkspace(true);
    };
    globalThis.addEventListener('resize', update);
    return () => globalThis.removeEventListener('resize', update);
  }, [isWeb]);

  useLayoutEffect(() => {
    if (supported || !stateRef.current) return;
    const overlay = stateRef.current;
    const previousFocus = document.activeElement;
    const retained = new Map<HTMLElement, { inert: string | null; hidden: string | null }>();
    const hideWorkspace = () => {
      for (const child of document.body.children) {
        if (!(child instanceof HTMLElement) || child === overlay || retained.has(child)) continue;
        retained.set(child, {
          inert: child.getAttribute('inert'),
          hidden: child.getAttribute('aria-hidden'),
        });
        child.setAttribute('inert', '');
        child.setAttribute('aria-hidden', 'true');
      }
    };
    hideWorkspace();
    const observer = new MutationObserver(hideWorkspace);
    observer.observe(document.body, { childList: true });
    const containFocus = () => {
      if (!overlay.contains(document.activeElement)) overlay.focus();
    };
    const containKeys = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      overlay.focus();
    };
    document.addEventListener('focusin', containFocus, true);
    document.addEventListener('keydown', containKeys, true);
    overlay.focus();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', containFocus, true);
      document.removeEventListener('keydown', containKeys, true);
      for (const [element, attributes] of retained) {
        for (const [name, value] of [
          ['inert', attributes.inert],
          ['aria-hidden', attributes.hidden],
        ] as const) {
          if (value === null) element.removeAttribute(name);
          else element.setAttribute(name, value);
        }
      }
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [supported]);

  return (
    <>
      {hasMountedWorkspace && children}
      {!supported &&
        createPortal(
          <main
            ref={stateRef}
            className="unsupported-viewport"
            style={{ position: 'fixed', inset: 0, zIndex: 2147483647 }}
            aria-label="Larger window required"
            tabIndex={-1}
          >
            <div className="unsupported-viewport__mark" aria-hidden="true">
              R
            </div>
            <h1>Larger window required</h1>
            <p>Relay Web needs a desktop browser window at least 1024 pixels wide.</p>
            <p>
              Maximize the window or reduce browser zoom until the workspace fits. Phones and narrow
              tablets are not supported.
            </p>
          </main>,
          document.body,
        )}
    </>
  );
}
