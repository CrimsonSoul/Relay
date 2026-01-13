import React, { useState, useRef, useLayoutEffect } from 'react';
import { Tooltip } from './Tooltip';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: React.ReactNode;
  variant?: 'default' | 'vivid';
  label?: string;
  containerStyle?: React.CSSProperties;
};

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ style, icon, className, variant: _variant = 'default', label, containerStyle, ...props }, ref) => {
  const innerRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(!!props.value || !!props.defaultValue);

  // Separate layout styles for wrapper vs visual styles for input
  const {
    width, height, minWidth, minHeight, maxWidth, maxHeight,
    margin, marginTop, marginBottom, marginLeft, marginRight,
    flex, flexGrow, flexShrink, flexBasis,
    position, zIndex, top, bottom, left, right,
    ...inputStyle
  } = style || {};

  // Sync internal ref with external ref if provided
  useLayoutEffect(() => {
    if (typeof ref === 'function') {
      ref(innerRef.current);
    } else if (ref) {
      (ref as React.MutableRefObject<HTMLInputElement | null>).current = innerRef.current;
    }
  }, [ref]);

  useLayoutEffect(() => {
    if (props.value !== undefined) {
      setHasValue(!!props.value);
    }
  }, [props.value]);

  useLayoutEffect(() => {
    if (props.autoFocus && innerRef.current) {
      setTimeout(() => innerRef.current?.focus(), 150);
    }
  }, [props.autoFocus]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (innerRef.current) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(innerRef.current, '');

      const event = new Event('input', { bubbles: true });
      innerRef.current.dispatchEvent(event);

      if (props.onChange) {
        const syntheticEvent = {
          ...e,
          target: innerRef.current,
          currentTarget: innerRef.current,
          bubbles: true,
          cancelable: false,
          type: 'change'
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        syntheticEvent.target.value = '';
        props.onChange(syntheticEvent);
      }

      // Update local state immediately for uncontrolled usage
      setHasValue(false);
    }
    innerRef.current?.focus();
  };

  return (
    <div style={{
      position: position || 'relative',
      width: width || '100%',
      height, minWidth, minHeight, maxWidth, maxHeight,
      margin, marginTop, marginBottom, marginLeft, marginRight,
      flex, flexGrow, flexShrink, flexBasis,
      zIndex, top, bottom, left, right,
      ...containerStyle
    }}>
      {label && (
        <label className="text-truncate" style={{
          display: 'block',
          fontSize: '15px',
          fontWeight: 650,
          color: 'var(--color-text-secondary)',
          marginBottom: '8px',
          letterSpacing: '0.01em'
        }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          ref={innerRef}
          style={{
            width: '100%',
            background: 'var(--color-bg-surface)',
            border: 'var(--border-medium)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            paddingLeft: icon ? '36px' : '14px',
            paddingRight: hasValue ? '36px' : '14px',
            fontSize: '15px',
            color: 'var(--color-text-primary)',
            outline: 'none',
            fontFamily: 'var(--font-family-base)',
            transition: 'all var(--transition-base)',
            boxShadow: 'var(--shadow-xs)',
            letterSpacing: '-0.01em',
            ...inputStyle
          }}
          onFocus={(e) => {
            setHasValue(!!e.target.value);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setHasValue(!!e.target.value);
            props.onBlur?.(e);
          }}
          {...props}
          className={className}
          onChange={(e) => {
            // Update local state for both controlled and uncontrolled
            setHasValue(!!e.target.value);
            props.onChange?.(e);
          }}
        />

        {icon && (
          <div
            className="input-icon"
            style={{
              position: 'absolute',
              left: '16px', // Increased padding for pill style
              top: '50%',
              transform: 'translateY(-50%)',
              pointerEvents: 'none',
              display: 'flex',
              alignItems: 'center',
              zIndex: 10
            }}
          >
            {icon}
          </div>
        )}

        {hasValue && !props.readOnly && !props.disabled && (
          <Tooltip content="Clear" position="top">
            <div
              onClick={handleClear}
              data-testid="input-clear-button"
              style={{
                position: 'absolute',
                right: 'var(--space-2)',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '18px',
                height: '18px',
                borderRadius: 'var(--radius-round)',
                background: 'rgba(255, 255, 255, 0.08)',
                zIndex: 50,
                transition: 'all var(--transition-fast)',
                border: '1px solid transparent'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                e.currentTarget.style.transform = 'translateY(-50%) scale(1.05)';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = 'var(--color-text-secondary)';
                e.currentTarget.style.borderColor = 'transparent';
                e.currentTarget.style.transform = 'translateY(-50%) scale(1)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </div>
          </Tooltip>
        )}
      </div>
    </div>
  );
});

Input.displayName = 'Input';
