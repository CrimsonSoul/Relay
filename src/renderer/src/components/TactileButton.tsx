import React, { ReactNode } from 'react';
import { Tooltip } from './Tooltip';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md';
  active?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
  tooltip?: ReactNode;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
};

export const TactileButton: React.FC<Props> = ({
  children,
  variant = 'secondary',
  size = 'md',
  active = false,
  icon,
  loading = false,
  block = false,
  tooltip,
  tooltipPosition = 'top',
  className = '',
  style,
  disabled,
  title,
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
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const isDisabled = disabled || loading;
  const ariaLabel = props['aria-label'];
  const isIconOnly = !children && icon;
  let inferredTooltip: string | undefined;
  if (isIconOnly && typeof ariaLabel === 'string') {
    inferredTooltip = ariaLabel;
  } else if (isIconOnly && typeof title === 'string') {
    inferredTooltip = title;
  }
  const tooltipContent = tooltip ?? inferredTooltip;

  const button = (
    <button
      type={props.type ?? 'button'}
      style={style}
      className={classes}
      disabled={isDisabled}
      title={title}
      {...props}
    >
      {loading && (
        <span className="animate-spin tactile-button-spinner">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          >
            <path
              d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83"
              strokeOpacity={0.3}
            />
            <path d="M12 2v4" />
          </svg>
        </span>
      )}
      {!loading && icon && <span className="tactile-button-icon">{icon}</span>}

      {children && <span className="tactile-button-label">{children}</span>}
    </button>
  );

  if (!tooltipContent) return button;

  return (
    <Tooltip content={tooltipContent} position={tooltipPosition}>
      {button}
    </Tooltip>
  );
};
