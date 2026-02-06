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
  autoFocus?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
}

export const Combobox: React.FC<ComboboxProps> = ({
  value,
  onChange,
  options,
  placeholder,
  style,
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
    <div ref={containerRef} style={{ position: 'relative', width: '100%', ...style }}>
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
        style={{
          ...style,
          width: '100%',
        }}
      />

      {isOpen && (filteredOptions.length > 0 || !value) && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: '4px',
            background: 'var(--color-bg-chrome)',
            border: 'var(--border-medium)',
            borderRadius: '10px',
            maxHeight: '200px',
            overflowY: 'auto',
            zIndex: 9999,
            boxShadow: 'var(--shadow-lg)',
            padding: '4px',
          }}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt, idx) => (
              <div
                key={`${opt.value}-${idx}`}
                role="option"
                aria-selected={false}
                tabIndex={0}
                onClick={() => handleSelect(opt.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelect(opt.value);
                  }
                }}
                style={{
                  padding: '8px 12px',
                  fontSize: '13px',
                  color: 'var(--color-text-primary)',
                  cursor: 'pointer',
                  borderRadius: '4px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--color-bg-surface-elevated)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                <span className="text-truncate">{opt.label}</span>
                {opt.subLabel && (
                  <span
                    className="text-truncate"
                    style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
                  >
                    {opt.subLabel}
                  </span>
                )}
              </div>
            ))
          ) : (
            <div
              style={{
                padding: '8px 12px',
                fontSize: '13px',
                color: 'var(--color-text-tertiary)',
                fontStyle: 'italic',
              }}
            >
              No matches
            </div>
          )}
        </div>
      )}
    </div>
  );
};
