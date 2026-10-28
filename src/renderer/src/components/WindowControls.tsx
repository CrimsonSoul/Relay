import { cloneElement, useState, useEffect, type ComponentProps, type ReactElement } from 'react';
import { Tooltip } from './Tooltip';
import { hasRelayCapability } from '../runtime/relayRuntime';

type WindowControlsProps = {
  /**
   * One tooltip beside the group instead of one below each button, for a frame whose content below
   * is a native view (the Dynatrace popout) that would cover a tooltip hanging into it.
   */
  tooltipBeside?: boolean;
};

export const WindowControls = ({ tooltipBeside = false }: WindowControlsProps = {}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [hint, setHint] = useState('');
  const supported = hasRelayCapability('nativeWindowControls');

  // Sync with actual window maximize state
  useEffect(() => {
    if (!supported) return;
    // Check initial state
    globalThis.window.api
      ?.isMaximized?.()
      .then((maximized: boolean) => {
        setIsMaximized(maximized);
      })
      .catch(() => {
        // Fallback if API not available yet
      });

    // Listen for maximize/unmaximize events from main process
    const handleMaximizeChange = (maximized: boolean) => {
      setIsMaximized(maximized);
    };

    const cleanup = globalThis.window.api?.onMaximizeChange?.(handleMaximizeChange);

    return () => {
      cleanup?.();
    };
  }, [supported]);

  const handleMinimize = () => globalThis.window.api?.windowMinimize();
  const handleMaximize = () => {
    globalThis.window.api?.windowMaximize();
    // Optimistically toggle state immediately for responsive UI
    // The listener will correct if needed
    setIsMaximized((prev) => !prev);
  };
  const handleClose = () => globalThis.window.api?.windowClose();

  const btnClass = 'window-control-btn';
  const tip = (content: string, button: ReactElement<ComponentProps<'button'>>) =>
    tooltipBeside ? (
      cloneElement(button, {
        onMouseEnter: () => setHint(content),
        onFocus: () => setHint(content),
      })
    ) : (
      <Tooltip content={content} position="bottom">
        {button}
      </Tooltip>
    );
  const maximizeLabel = isMaximized ? 'Restore Down' : 'Maximize';
  if (!supported) return null;
  if (
    globalThis.window.api &&
    'platform' in globalThis.window.api &&
    globalThis.window.api.platform === 'darwin'
  )
    return null;

  const bar = (
    <div className="window-controls-bar">
      {tip(
        'Minimize',
        <button type="button" onClick={handleMinimize} className={btnClass} aria-label="Minimize">
          <svg aria-hidden="true" width="10" height="1" viewBox="0 0 10 1">
            <path d="M0 0h10v1H0z" fill="currentColor" />
          </svg>
        </button>,
      )}

      {tip(
        maximizeLabel,
        <button
          type="button"
          onClick={handleMaximize}
          className={btnClass}
          aria-label={maximizeLabel}
        >
          {isMaximized ? (
            // Restore icon (two overlapping squares, like Edge/Windows)
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              {/* Front window */}
              <path d="M0 2v8h8V2H0zm7 7H1V3h6v6z" />
              {/* Back window (top-right offset) */}
              <path d="M2 0v2h1V1h6v6H8v1h2V0H2z" />
            </svg>
          ) : (
            // Maximize icon (single square)
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
            </svg>
          )}
        </button>,
      )}
      {tip(
        'Close',
        <button
          type="button"
          onClick={handleClose}
          className={`${btnClass} close-btn`}
          aria-label="Close"
        >
          <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M1.05 0L0 1.05 3.95 5 0 8.95 1.05 10 5 6.05 8.95 10 10 8.95 6.05 5 10 1.05 8.95 0 5 3.95z"
              fill="currentColor"
            />
          </svg>
        </button>,
      )}
    </div>
  );

  return tooltipBeside ? (
    <Tooltip content={hint} position="left" describesTrigger={false}>
      {bar}
    </Tooltip>
  ) : (
    bar
  );
};
