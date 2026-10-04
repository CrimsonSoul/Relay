import React, { useEffect, useId, useRef, useState } from 'react';
import {
  clampOnCallFontScale,
  ON_CALL_FONT_SCALE_MAX,
  ON_CALL_FONT_SCALE_MIN,
  ON_CALL_FONT_SCALE_STEP,
} from '../../theme/onCallDisplay';
import { TactileButton } from '../TactileButton';

type Props = Readonly<{
  value: number;
  onChange?: (scale: number) => void;
  /** Picks the largest scale at which every team fits on screen; omitted when scale is read-only. */
  onFitToScreen?: () => void;
  disabled?: boolean;
}>;

/**
 * One "Text Size" command that opens a small non-modal popover holding the board font scale
 * (A-, slider, A+) and Fit to Screen. It closes on Escape (focus returns to the trigger), an
 * outside click, or when focus leaves it, so the command bar spends a single control on a view
 * preference.
 */
export const OnCallDisplayControl: React.FC<Props> = ({
  value,
  onChange,
  onFitToScreen,
  disabled = false,
}) => {
  const fontScale = clampOnCallFontScale(value);
  const handleChange = (nextScale: number) => onChange?.(clampOnCallFontScale(nextScale));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const popoverId = useId();
  const isOpen = open && !disabled;

  useEffect(() => {
    if (!isOpen) return;
    sliderRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    // Escape closes only while focus is inside the control, returning focus to Text Size.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !rootRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  return (
    <div
      ref={rootRef}
      className="oncall-display"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <TactileButton
        ref={triggerRef}
        variant="secondary"
        className="oncall-command-action"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? popoverId : undefined}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
      >
        Text Size <span className="oncall-display__scale">{fontScale}%</span>
      </TactileButton>
      {isOpen && (
        <div // NOSONAR - non-modal popover; <dialog> would change its modality and focus handling.
          id={popoverId}
          role="dialog"
          aria-label="Text size"
          className="oncall-display__popover"
          data-motion="popover"
        >
          <fieldset className="oncall-font-scale-control" aria-label="Board text size">
            <button
              type="button"
              className="oncall-font-scale-button"
              aria-label="Smaller text"
              disabled={!onChange || fontScale <= ON_CALL_FONT_SCALE_MIN}
              onClick={() => handleChange(fontScale - ON_CALL_FONT_SCALE_STEP)}
            >
              A-
            </button>
            <input
              ref={sliderRef}
              className="oncall-font-scale-slider"
              type="range"
              min={ON_CALL_FONT_SCALE_MIN}
              max={ON_CALL_FONT_SCALE_MAX}
              step={ON_CALL_FONT_SCALE_STEP}
              value={fontScale}
              aria-label="Text size"
              aria-valuetext={`${fontScale}%`}
              disabled={!onChange}
              onChange={(event) => handleChange(Number(event.target.value))}
            />
            <output className="oncall-font-scale-value">{fontScale}%</output>
            <button
              type="button"
              className="oncall-font-scale-button"
              aria-label="Larger text"
              disabled={!onChange || fontScale >= ON_CALL_FONT_SCALE_MAX}
              onClick={() => handleChange(fontScale + ON_CALL_FONT_SCALE_STEP)}
            >
              A+
            </button>
          </fieldset>
          {onFitToScreen && (
            <TactileButton
              size="sm"
              variant="secondary"
              className="oncall-display__fit"
              onClick={onFitToScreen}
            >
              Fit to Screen
            </TactileButton>
          )}
        </div>
      )}
    </div>
  );
};
