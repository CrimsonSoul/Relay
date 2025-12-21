import React, { ReactNode } from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  active?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
};

export const TactileButton: React.FC<Props> = ({
  children,
  variant = 'secondary', // Default to secondary now as per design system
  size = 'md',
  active = false,
  icon,
  loading = false,
  block = false,
  className = '',
  style,
  disabled,
  ...props
}) => {
  const classes = [
    'tactile-button',
    `tactile-button--${variant}`,
    `tactile-button--${size}`,
    active ? 'is-active' : '',
    loading ? 'is-loading' : '',
    block ? 'is-block' : '',
    !children && icon ? 'tactile-button--icon-only' : '',
    className
  ].filter(Boolean).join(' ');

  const isDisabled = disabled || loading;

  return (
    <button
      type={props.type ?? 'button'}
      style={{
        width: block ? '100%' : undefined,
        ...style
      }}
      className={classes}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <span className="animate-spin" style={{ display: 'inline-block' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" strokeOpacity={0.3} />
            <path d="M12 2v4" />
          </svg>
        </span>
      ) : icon ? (
        <span style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px' // standard icon size
        }}>
          {icon}
        </span>
      ) : null}

      {children && (
        <span style={{ position: 'relative', zIndex: 2 }}>
          {children}
        </span>
      )}
    </button>
  );
};
