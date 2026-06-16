import React from 'react';
import { ON_CALL_DISPLAY_SIZES, type OnCallDisplaySize } from '../../theme/onCallDisplay';
import { SizeSegmentedControl } from '../SizeSegmentedControl';

type Props = {
  value: OnCallDisplaySize;
  onChange?: (size: OnCallDisplaySize) => void;
};

export const OnCallDisplayControl: React.FC<Props> = ({ value, onChange }) => (
  <SizeSegmentedControl
    ariaLabel="On-call board text size"
    value={value}
    onChange={onChange}
    options={ON_CALL_DISPLAY_SIZES.map((option) => ({
      id: option.id,
      label: option.label,
      shortLabel: option.label.slice(0, 1),
    }))}
    titleSuffix="board text"
    className="oncall-display-control"
    optionClassName="oncall-display-option"
    activeOptionClassName="oncall-display-option--active"
  />
);
