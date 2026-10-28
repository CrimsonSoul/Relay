import { useEffect, useState } from 'react';
import type { DynatraceNavigationAction, DynatraceNavigationState } from '@shared/dynatrace';
import { Tooltip } from './Tooltip';

const isMac = () => globalThis.api?.platform === 'darwin';

const BUTTONS: ReadonlyArray<{
  action: DynatraceNavigationAction;
  label: string;
  shortcut: () => string;
  path: string;
}> = [
  {
    action: 'back',
    label: 'Back',
    shortcut: () => (isMac() ? '⌘[' : 'Alt+←'),
    path: 'M10 3 5 8l5 5',
  },
  {
    action: 'forward',
    label: 'Forward',
    shortcut: () => (isMac() ? '⌘]' : 'Alt+→'),
    path: 'm6 3 5 5-5 5',
  },
  {
    action: 'reload',
    label: 'Reload',
    shortcut: () => (isMac() ? '⌘R' : 'Ctrl+R'),
    path: 'M13 8a5 5 0 1 1-1.5-3.6M13 2.5v3h-3',
  },
];

/**
 * Back, Forward and Reload for the Dynatrace page a popout hosts; the page itself has no chrome.
 * The page is a native view drawn over everything below this 56 px strip, and system tooltips do
 * not show in a title bar, so one Relay tooltip beside the group names the button under the pointer
 * and stays inside the strip without covering a neighbouring button.
 */
export function DynatracePopoutNavigation() {
  const [state, setState] = useState<DynatraceNavigationState>({
    canGoBack: false,
    canGoForward: false,
  });
  const [hint, setHint] = useState('');
  const api = globalThis.api;

  useEffect(() => api?.onDynatraceNavigationState?.(setState), [api]);

  if (!api?.navigateDynatrace) return null;
  const navigate = api.navigateDynatrace;

  // The group reads the hovered button itself: React skips pointer handlers on a disabled button,
  // and a greyed-out Back still needs naming.
  const showHintFor = (target: EventTarget) => {
    const button = target instanceof Element ? target.closest<HTMLElement>('[data-hint]') : null;
    if (button?.dataset.hint) setHint(button.dataset.hint);
  };

  const enabled = (action: DynatraceNavigationAction) =>
    action === 'reload' || (action === 'back' ? state.canGoBack : state.canGoForward);

  return (
    <Tooltip content={hint} position="right" describesTrigger={false}>
      <nav
        className="popout-nav"
        aria-label="Dynatrace page"
        onMouseOver={(event) => showHintFor(event.target)}
        onFocus={(event) => showHintFor(event.target)}
      >
        {BUTTONS.map(({ action, label, shortcut, path }) => {
          return (
            <button
              key={action}
              type="button"
              className="popout-nav-btn"
              aria-label={label}
              data-hint={`${label} (${shortcut()})`}
              disabled={!enabled(action)}
              onClick={() => void navigate(action)}
            >
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d={path}
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          );
        })}
      </nav>
    </Tooltip>
  );
}
