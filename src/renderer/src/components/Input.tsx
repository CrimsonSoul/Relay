import React, { useState, useRef, useEffect, useId } from 'react';
import { Tooltip } from './Tooltip';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: React.ReactNode;
  variant?: 'default' | 'vivid';
  label?: string;
  containerStyle?: React.CSSProperties;
  ref?: React.Ref<HTMLInputElement>;
};

export const Input: React.FC<InputProps> = ({
  style,
  icon,
  className,
  variant: _variant = 'default',
  label,
  containerStyle,
  id: providedId,
  ref,
  ...props
}) => {
  const innerRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(!!props.value || !!props.defaultValue);
  const generatedId = useId();
  const id = providedId || generatedId;

  // Sync internal ref with external ref if provided
  useEffect(() => {
    if (typeof ref === 'function') {
      ref(innerRef.current);
    } else if (ref) {
      ref.current = innerRef.current;
    }
  }, [ref]);

  useEffect(() => {
    if (props.value !== undefined) {
      setHasValue(!!props.value);
    }
  }, [props.value]);

  useEffect(() => {
    if (props.autoFocus && innerRef.current) {
      setTimeout(() => innerRef.current?.focus(), 150);
    }
  }, [props.autoFocus]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (innerRef.current) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        globalThis.HTMLInputElement.prototype,
        'value',
      )?.set;
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
          type: 'change',
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        syntheticEvent.target.value = '';
        props.onChange(syntheticEvent);
      }

      setHasValue(false);
    }
    innerRef.current?.focus();
  };

  return (
    <div className="input-wrapper" style={containerStyle}>
      {label && (
        <label htmlFor={id} className="input-label text-truncate">
          {label}
        </label>
      )}
      <div className="input-inner">
        <input
          id={id}
          ref={innerRef}
          style={{ ...(icon ? { paddingLeft: '40px' } : {}), ...style }}
          onFocus={(e) => {
            setHasValue(!!e.target.value);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setHasValue(!!e.target.value);
            props.onBlur?.(e);
          }}
          {...props}
          className={`tactile-input ${className}`}
          onChange={(e) => {
            setHasValue(!!e.target.value);
            props.onChange?.(e);
          }}
        />

        {icon && <div className="input-icon">{icon}</div>}

        {hasValue && !props.readOnly && !props.disabled && (
          <Tooltip content="Clear" position="top">
            <button
              type="button"
              onClick={handleClear}
              aria-label="Clear input"
              data-testid="input-clear-button"
              className="input-clear-btn"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
};
