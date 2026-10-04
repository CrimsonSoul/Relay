import React, { useState, useRef, useEffect, useLayoutEffect, useId, useCallback } from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement<TooltipTriggerProps>;
  position?: TooltipPosition;
  width?: string;
  block?: boolean;
  delay?: number;
  triggerStyle?: React.CSSProperties;
  /**
   * Link the popup to its trigger with aria-describedby (the default). Pass false when the
   * trigger's accessible name already carries everything the popup says, so it is not read twice.
   */
  describesTrigger?: boolean;
}

type TooltipTriggerProps = Pick<
  React.DOMAttributes<Element>,
  'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur' | 'onPointerDown'
> &
  Pick<React.AriaAttributes, 'aria-describedby' | 'aria-label'> & { disabled?: boolean };

/** Grace period so the pointer can cross the gap onto the popup (WCAG 1.4.13 hoverable). */
export const TOOLTIP_HIDE_GRACE_MS = 100;

/** Gap between the trigger and the popup; the popup's minimum inset from the viewport edge. */
const TOOLTIP_GAP = 8;
export const TOOLTIP_VIEWPORT_MARGIN = 8;

/** How each side's transform shifts the popup from its anchor, as a fraction of its own size. */
const PLACEMENT: Record<TooltipPosition, { x: number; y: number; transform: string }> = {
  top: { x: -0.5, y: -1, transform: 'translate(-50%, -100%)' },
  bottom: { x: -0.5, y: 0, transform: 'translate(-50%, 0)' },
  left: { x: -1, y: -0.5, transform: 'translate(-100%, -50%)' },
  right: { x: 0, y: -0.5, transform: 'translate(0, -50%)' },
};

interface Box {
  width: number;
  height: number;
}

/** Viewport-space point beside the trigger that the popup's transform hangs from. */
const anchorFor = (rect: DOMRect, position: TooltipPosition) => {
  switch (position) {
    case 'bottom':
      return { x: rect.left + rect.width / 2, y: rect.bottom + TOOLTIP_GAP };
    case 'left':
      return { x: rect.left - TOOLTIP_GAP, y: rect.top + rect.height / 2 };
    case 'right':
      return { x: rect.right + TOOLTIP_GAP, y: rect.top + rect.height / 2 };
    case 'top':
    default:
      return { x: rect.left + rect.width / 2, y: rect.top - TOOLTIP_GAP };
  }
};

/** Keeps `start` (one edge of a span `size` long) inside `[margin, limit - margin]` where it fits. */
const clampSpan = (start: number, size: number, limit: number) =>
  Math.max(TOOLTIP_VIEWPORT_MARGIN, Math.min(start, limit - TOOLTIP_VIEWPORT_MARGIN - size));

const OPPOSITE: Record<TooltipPosition, TooltipPosition> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

/** Whether a popup of `popup` size fits on `position`'s side of `rect` without leaving the margin. */
const fitsSide = (rect: DOMRect, popup: Box, position: TooltipPosition, viewport: Box) => {
  const anchor = anchorFor(rect, position);
  switch (position) {
    case 'bottom':
      return anchor.y + popup.height <= viewport.height - TOOLTIP_VIEWPORT_MARGIN;
    case 'left':
      return anchor.x - popup.width >= TOOLTIP_VIEWPORT_MARGIN;
    case 'right':
      return anchor.x + popup.width <= viewport.width - TOOLTIP_VIEWPORT_MARGIN;
    case 'top':
    default:
      return anchor.y - popup.height >= TOOLTIP_VIEWPORT_MARGIN;
  }
};

/**
 * Viewport-space anchor and side for a popup of `popup` size beside `rect`. A popup with no room
 * on its preferred side flips to the opposite side when that one has room, so it never clamps
 * over its own trigger and swallows the click; it is then moved so the whole popup stays
 * TOOLTIP_VIEWPORT_MARGIN inside a viewport of `viewport` size.
 */
export const placeTooltip = (
  rect: DOMRect,
  popup: Box,
  preferred: TooltipPosition,
  viewport: Box,
) => {
  const position =
    !fitsSide(rect, popup, preferred, viewport) &&
    fitsSide(rect, popup, OPPOSITE[preferred], viewport)
      ? OPPOSITE[preferred]
      : preferred;
  const anchor = anchorFor(rect, position);
  const { x, y } = PLACEMENT[position];
  const left = clampSpan(anchor.x + x * popup.width, popup.width, viewport.width);
  const top = clampSpan(anchor.y + y * popup.height, popup.height, viewport.height);
  return { left: left - x * popup.width, top: top - y * popup.height, position };
};

const ORIGIN: { top: number; left: number; side?: TooltipPosition } = { top: 0, left: 0 };

export const Tooltip: React.FC<Readonly<TooltipProps>> = ({
  content,
  children,
  position = 'top',
  width = 'max-content',
  block = false,
  delay = 0,
  triggerStyle,
  describesTrigger = true,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  // Only a pointer-opened popup takes pointer events (WCAG 1.4.13 hoverable); a focus-opened
  // one stays click-through so it never blocks the content it overlaps.
  const [openedByPointer, setOpenedByPointer] = useState(false);
  // Pressing the trigger dismisses its tooltip until the pointer leaves, so the focus that
  // follows the press does not reopen it over the content the user moves on to.
  const suppressedRef = useRef(false);
  // True while the trigger holds focus that arrived without a press (keyboard focus), so a
  // pointer passing over and out does not close the popup the keyboard user opened.
  const keyboardFocusedRef = useRef(false);
  const [coords, setCoords] = useState(ORIGIN);
  // Bumped by scroll and resize so a visible popup follows its trigger.
  const [reflow, setReflow] = useState(0);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const popupShown = isVisible && Boolean(content);

  // Layout effect, not passive: a passive effect measures after the popup has
  // already painted at the stale {0,0}, so the first hover on any icon button
  // flashes in the top-left corner before snapping into place. A hidden popup
  // returns to the origin so it is measured at its natural width next time.
  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const popup = popupRef.current;
    if (!popupShown || !trigger || !popup) {
      setCoords(ORIGIN);
      return;
    }
    const target = trigger.firstElementChild || trigger;
    const place = placeTooltip(
      target.getBoundingClientRect(),
      { width: popup.offsetWidth, height: popup.offsetHeight },
      position,
      { width: globalThis.innerWidth, height: globalThis.innerHeight },
    );
    const top = place.top + globalThis.scrollY;
    const left = place.left + globalThis.scrollX;
    setCoords((prev) =>
      prev.top === top && prev.left === left && prev.side === place.position
        ? prev
        : { top, left, side: place.position },
    );
  }, [popupShown, position, content, width, reflow]);

  const clearTimer = useCallback(() => {
    clearTimeout(timerRef.current ?? undefined);
    timerRef.current = null;
  }, []);

  const show = (byPointer: boolean) => {
    if (suppressedRef.current) return;
    clearTimer();
    setOpenedByPointer(byPointer);
    if (delay > 0) {
      timerRef.current = setTimeout(() => setIsVisible(true), delay);
    } else {
      setIsVisible(true);
    }
  };

  const hide = useCallback(() => {
    clearTimer();
    setIsVisible(false);
  }, [clearTimer]);

  // Leaving the trigger (or the popup) waits briefly so the pointer can move
  // onto the popup without it vanishing. A pending delayed show is cancelled. A trigger that
  // still holds keyboard focus keeps its popup (it closes on blur or Escape), back in the
  // click-through focus-opened state.
  const hideAfterGrace = () => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (keyboardFocusedRef.current) {
        setOpenedByPointer(false);
        return;
      }
      setIsVisible(false);
    }, TOOLTIP_HIDE_GRACE_MS);
  };

  // While a popup is visible: Escape closes only the tooltip (WCAG 1.4.13 dismissible), caught in
  // the capture phase so a modal underneath keeps its own Escape for the next press; scroll and
  // resize re-place it beside its trigger.
  useEffect(() => {
    if (!popupShown) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      // Dismissed: a later pointer pass closes it on leave even while focus stays.
      keyboardFocusedRef.current = false;
      hide();
    };
    const onViewportChange = () => setReflow((n) => n + 1);
    globalThis.addEventListener('keydown', onKeyDown, true);
    globalThis.addEventListener('scroll', onViewportChange, true);
    globalThis.addEventListener('resize', onViewportChange);
    return () => {
      globalThis.removeEventListener('keydown', onKeyDown, true);
      globalThis.removeEventListener('scroll', onViewportChange, true);
      globalThis.removeEventListener('resize', onViewportChange);
    };
  }, [popupShown, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  // A trigger disabled while it is focused (Refresh during its own run) gets no blur in Chromium,
  // so a focus-opened popup would linger with stale copy. Close it when `disabled` turns on; a
  // trigger that is already disabled still shows its tooltip on hover.
  const triggerDisabled = Boolean(children.props.disabled);
  useEffect(() => {
    if (triggerDisabled) hide();
  }, [triggerDisabled, hide]);

  const childProps = children.props;
  // Skip the description when the accessible name already says the same thing.
  const duplicatesName =
    !describesTrigger || (typeof content === 'string' && content === childProps['aria-label']);
  const describedBy =
    popupShown && !duplicatesName
      ? [childProps['aria-describedby'], tooltipId].filter(Boolean).join(' ')
      : childProps['aria-describedby'];
  const trigger = React.cloneElement(children, {
    'aria-describedby': describedBy,
    onMouseEnter: (event: React.MouseEvent<Element>) => {
      childProps.onMouseEnter?.(event);
      show(true);
    },
    onMouseLeave: (event: React.MouseEvent<Element>) => {
      childProps.onMouseLeave?.(event);
      suppressedRef.current = false;
      hideAfterGrace();
    },
    onPointerDown: (event: React.PointerEvent<Element>) => {
      childProps.onPointerDown?.(event);
      suppressedRef.current = true;
      keyboardFocusedRef.current = false;
      hide();
    },
    onFocus: (event: React.FocusEvent<Element>) => {
      childProps.onFocus?.(event);
      keyboardFocusedRef.current = !suppressedRef.current;
      show(false);
    },
    onBlur: (event: React.FocusEvent<Element>) => {
      childProps.onBlur?.(event);
      keyboardFocusedRef.current = false;
      hide();
    },
  });

  return (
    <>
      <span
        ref={triggerRef}
        className={`tooltip-trigger${block ? ' tooltip-trigger--block' : ''}`}
        style={triggerStyle}
      >
        {trigger}
      </span>
      {popupShown &&
        createPortal(
          <div
            ref={popupRef}
            id={tooltipId}
            role="tooltip"
            className={openedByPointer ? 'tooltip-popup tooltip-popup--hoverable' : 'tooltip-popup'}
            data-motion="popover"
            onMouseEnter={clearTimer}
            onMouseLeave={hideAfterGrace}
            style={{
              top: coords.top,
              left: coords.left,
              transform: PLACEMENT[coords.side ?? position].transform,
              width,
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
};
