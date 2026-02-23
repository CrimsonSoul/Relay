import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from './Input';
import { useOnClickOutside } from '../hooks/useOnClickOutside';

interface ComboboxOption {
  label: string;
  value: string;
  subLabel?: string;
}

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  autoFocus?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

export const Combobox: React.FC<ComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder,
  style,
  className,
  autoFocus,
  onOpenChange,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useOnClickOutside(containerRef, () => setIsOpen(false));

  const filteredOptions = useMemo(() => {
    if (!value) return options;
    const lower = value.toLowerCase();

    // If the current value is an exact match, show all options to allow switching
    const exactMatch = options.some(
      (o) => o.label.toLowerCase() === lower || o.value.toLowerCase() === lower,
    );
    if (exactMatch && !isOpen) return options;

    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(lower) ||
        o.value.toLowerCase().includes(lower) ||
        o.subLabel?.toLowerCase().includes(lower),
    );
  }, [value, options, isOpen]);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className={`combobox ${className || ''}`} style={style}>
      <Input
        ref={inputRef}
        value={value}
        variant="vivid"
        onChange={(e) => {
          onChange(e.target.value);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
        }}
        onBlur={() => {}}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
        style={{
          ...style,
          width: '100%',
        }}
      />

      {isOpen && (filteredOptions.length > 0 || value) && (
        <div className="combobox-dropdown">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <button
                type="button"
                key={`${opt.value}-${idx}`}
                onClick={() => handleSelect(opt.value)}
                className="combobox-option"
              >
                <span className="text-truncate">{opt.label}</span>
                {opt.subLabel && (
                  <span className="text-truncate combobox-option-sublabel">{opt.subLabel}</span>
                )}
              </button>
            ))
          ) : (
            <div className="combobox-empty">No matches</div>
          )}
        </div>
      )}
    </div>
  );
};
