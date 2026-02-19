import React, { useState, useEffect } from 'react';
import { Tooltip } from './Tooltip';

export const WindowControls = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  // Sync with actual window maximize state
  useEffect(() => {
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
    const handleMaximizeChange = (_event: unknown, maximized: boolean) => {
      setIsMaximized(maximized);
    };

    const cleanup = globalThis.window.api?.onMaximizeChange?.(handleMaximizeChange);

    return () => {
      cleanup?.();
    };
  }, []);

  const handleMinimize = () => globalThis.window.api?.windowMinimize();
  const handleMaximize = () => {
    globalThis.window.api?.windowMaximize();
    // Optimistically toggle state immediately for responsive UI
    // The listener will correct if needed
    setIsMaximized((prev) => !prev);
  };
  const handleClose = () => globalThis.window.api?.windowClose();

  const btnClass = 'window-control-btn';
  if (
    globalThis.window.api &&
    'platform' in globalThis.window.api &&
    globalThis.window.api.platform === 'darwin'
  )
    return null;

  return (
    <div className="window-controls-bar">
      <Tooltip content="Minimize" position="bottom">
        <button onClick={handleMinimize} className={btnClass} aria-label="Minimize">
          <svg width="10" height="1" viewBox="0 0 10 1">
            <path d="M0 0h10v1H0z" fill="currentColor" />
          </svg>
        </button>
      </Tooltip>

      <Tooltip content={isMaximized ? 'Restore Down' : 'Maximize'} position="bottom">
        <button
          onClick={handleMaximize}
          className={btnClass}
          aria-label={isMaximized ? 'Restore Down' : 'Maximize'}
        >
          {isMaximized ? (
            // Restore icon (two overlapping squares, like Edge/Windows)
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              {/* Front window */}
              <path d="M0 2v8h8V2H0zm7 7H1V3h6v6z" />
              {/* Back window (top-right offset) */}
              <path d="M2 0v2h1V1h6v6H8v1h2V0H2z" />
            </svg>
          ) : (
            // Maximize icon (single square)
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
            </svg>
          )}
        </button>
      </Tooltip>
      <Tooltip content="Close" position="bottom">
        <button onClick={handleClose} className={`${btnClass} close-btn`} aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path
              d="M1.05 0L0 1.05 3.95 5 0 8.95 1.05 10 5 6.05 8.95 10 10 8.95 6.05 5 10 1.05 8.95 0 5 3.95z"
              fill="currentColor"
            />
          </svg>
        </button>
      </Tooltip>
    </div>
  );
};
