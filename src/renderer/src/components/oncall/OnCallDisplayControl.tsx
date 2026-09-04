import React from 'react';
import {
  clampOnCallFontScale,
  ON_CALL_FONT_SCALE_MAX,
  ON_CALL_FONT_SCALE_MIN,
  ON_CALL_FONT_SCALE_STEP,
} from '../../theme/onCallDisplay';

type Props = {
  value: number;
  onChange?: (scale: number) => void;
  disabled?: boolean;
};

export const OnCallDisplayControl: React.FC<Props> = ({ value, onChange, disabled = false }) => {
  const fontScale = clampOnCallFontScale(value);
  const handleChange = (nextScale: number) => onChange?.(clampOnCallFontScale(nextScale));

  return (
    <fieldset
      className="oncall-font-scale-control"
      aria-label="On-call board font scale"
      disabled={disabled}
    >
      <button
        type="button"
        className="oncall-font-scale-button"
        aria-label="Decrease board font size"
        disabled={disabled || !onChange || fontScale <= ON_CALL_FONT_SCALE_MIN}
        onClick={() => handleChange(fontScale - ON_CALL_FONT_SCALE_STEP)}
      >
        A-
      </button>
      <input
        className="oncall-font-scale-slider"
        type="range"
        min={ON_CALL_FONT_SCALE_MIN}
        max={ON_CALL_FONT_SCALE_MAX}
        step={ON_CALL_FONT_SCALE_STEP}
        value={fontScale}
        aria-label="Board font scale"
        aria-valuetext={`${fontScale}%`}
        disabled={disabled || !onChange}
        onChange={(event) => handleChange(Number(event.target.value))}
      />
      <output className="oncall-font-scale-value">{fontScale}%</output>
      <button
        type="button"
        className="oncall-font-scale-button"
        aria-label="Increase board font size"
        disabled={disabled || !onChange || fontScale >= ON_CALL_FONT_SCALE_MAX}
        onClick={() => handleChange(fontScale + ON_CALL_FONT_SCALE_STEP)}
      >
        A+
      </button>
    </fieldset>
  );
};
