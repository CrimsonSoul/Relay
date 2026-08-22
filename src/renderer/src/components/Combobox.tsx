import React, { useState, useRef, useEffect, useLayoutEffect, useMemo, useCallback } from 'react';
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
  const [activeIndex, setActiveIndex] = useState(-1);
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
    setActiveIndex(-1);
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

  // Reposition dropdown when open. Layout effect, not passive: the dropdown
  // paints at {0,0} for a frame otherwise, flashing in the top-left corner.
  useLayoutEffect(() => {
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
    setActiveIndex(-1);
    inputRef.current?.blur();
  };

  // The option buttons are portaled to the end of <body>, outside the parent
  // dialog's focus trap, so Tab can never reach them — the keyboard path has to
  // run through the input. Escape must also stop here: left to bubble it hits
  // Modal's document-level listener and tears down the whole parent dialog.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      if (!isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      setActiveIndex(-1);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      if (filteredOptions.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => {
        if (current < 0) return step === 1 ? 0 : filteredOptions.length - 1;
        return (current + step + filteredOptions.length) % filteredOptions.length;
      });
      return;
    }

    if (event.key === 'Enter' && isOpen && activeIndex >= 0) {
      const option = filteredOptions[activeIndex];
      if (!option) return;
      event.preventDefault();
      handleSelect(option.value);
    }
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
          setActiveIndex(-1);
          if (!isOpen) setIsOpen(true);
        }}
        onFocus={() => {
          setIsOpen(true);
        }}
        onKeyDown={handleKeyDown}
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
            data-motion="popover"
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
                  data-active={idx === activeIndex ? 'true' : undefined}
                  // Keyboard highlight mirrors the :hover treatment; the option
                  // list has no focusable element of its own to style instead.
                  style={
                    idx === activeIndex ? { background: 'var(--color-bg-card-hover)' } : undefined
                  }
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
