import React, { useState, useRef, useEffect, useId } from 'react';
import { Tooltip } from './Tooltip';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  icon?: React.ReactNode;
  variant?: 'default' | 'vivid';
  label?: string;
  containerStyle?: React.CSSProperties;
  ref?: React.Ref<HTMLInputElement>;
  /** Field error copy. Sets aria-invalid, links the message through aria-describedby and
   *  renders it below the field with the shared `.field-error` treatment. */
  error?: string;
};

// A numeric 0 is a value; only absent or empty input counts as blank.
const isFilled = (value: InputProps['value']) => value !== undefined && String(value) !== '';

export const Input: React.FC<InputProps> = ({
  style,
  icon,
  className,
  variant: _variant = 'default',
  label,
  containerStyle,
  id: providedId,
  ref,
  error,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}) => {
  const innerRef = useRef<HTMLInputElement>(null);
  const [hasValue, setHasValue] = useState(isFilled(props.value) || isFilled(props.defaultValue));
  const generatedId = useId();
  const id = providedId || generatedId;
  const errorId = `${id}-error`;
  const describedByIds = [describedBy, error ? errorId : undefined].filter(Boolean).join(' ');

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
      setHasValue(isFilled(props.value));
    }
  }, [props.value]);

  useEffect(() => {
    if (props.autoFocus && innerRef.current) {
      const focusTimer = setTimeout(() => innerRef.current?.focus(), 150);
      return () => clearTimeout(focusTimer);
    }
    return undefined;
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
          style={style}
          onFocus={(e) => {
            setHasValue(!!e.target.value);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setHasValue(!!e.target.value);
            props.onBlur?.(e);
          }}
          {...props}
          aria-invalid={error ? true : ariaInvalid}
          aria-describedby={describedByIds || undefined}
          className={['tactile-input', icon && 'tactile-input--with-icon', className]
            .filter(Boolean)
            .join(' ')}
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
                aria-hidden="true"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
      {error && (
        <p id={errorId} className="input-error field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
