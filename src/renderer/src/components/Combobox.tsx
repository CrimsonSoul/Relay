import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Close on click outside either the container or the portal dropdown
  useOnClickOutside(containerRef, (e) => {
    if (dropdownRef.current?.contains(e.target as Node)) return;
    setIsOpen(false);
  });

  const updatePosition = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropdownPos({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  // Reposition dropdown when open
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();
    // Reposition on scroll/resize of any ancestor
    const handleReposition = () => updatePosition();
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [isOpen, updatePosition]);

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

  const showDropdown = isOpen && (filteredOptions.length > 0 || value);

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

      {showDropdown &&
        createPortal(
          <div
            ref={dropdownRef}
            className="combobox-dropdown"
            style={{
              position: 'fixed',
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
};
