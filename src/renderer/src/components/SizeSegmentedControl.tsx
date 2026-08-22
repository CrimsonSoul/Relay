import React from 'react';

export type SizeSegmentedControlOption<T extends string> = {
  id: T;
  label: string;
  shortLabel: string;
  title?: string;
};

type Props<T extends string> = Readonly<{
  options: readonly SizeSegmentedControlOption<T>[];
  value: T;
  onChange?: (value: T) => void;
  ariaLabel: string;
  className?: string;
  optionClassName?: string;
  activeOptionClassName?: string;
  titleSuffix?: string;
}>;

export function SizeSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  optionClassName,
  activeOptionClassName,
  titleSuffix,
}: Props<T>) {
  const controlClasses = ['size-segmented-control', className].filter(Boolean).join(' ');

  return (
    <div className={controlClasses} role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const isActive = value === option.id;
        const optionTitle = option.title ?? [option.label, titleSuffix].filter(Boolean).join(' ');
        const optionClasses = [
          'size-segmented-option',
          optionClassName,
          isActive ? 'size-segmented-option--active' : undefined,
          isActive ? activeOptionClassName : undefined,
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-label={option.label}
            aria-checked={isActive}
            title={optionTitle}
            className={optionClasses}
            onClick={() => onChange?.(option.id)}
          >
            <span aria-hidden="true">{option.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
